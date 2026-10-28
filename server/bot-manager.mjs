/* Управление ботами ZCode из мини-аппа: читает и аккуратно правит те же файлы,
   что и панель Bots в приложении:
     ~/.zcode/v2/bot-config.v3.json   — список ботов и настройки
     ~/.zcode/v2/bot-state.v3.json    — рантайм-состояние (только чтение)
     ~/.zcode/v2/credentials.json     — токены (enc:v1; мы умеем только УДАЛЯТЬ ключ)
     ~/.zcode/v2/bots-runtime-locks/  — живой поллинг по lock-файлам
   Токены никогда не читаются, не расшифровываются и не логируются:
   шифрование ZCode (enc:v1) проприетарное, вставка нового токена — через панель на ПК. */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";

const REPLY_MODES = ["assistant_changes", "assistant_toolcalls_changes", "summary_changes", "streaming_card"];
const BOT_COMMANDS = ["status", "new", "workspace", "model", "mode", "thoughtLevel", "reply"];

export class BotManager {
  constructor({ zcodeDir } = {}) {
    this.events = new EventEmitter();
    this.dir = zcodeDir || path.join(os.homedir(), ".zcode", "v2");
    this.configPath = path.join(this.dir, "bot-config.v3.json");
    this.statePath = path.join(this.dir, "bot-state.v3.json");
    this.credentialsPath = path.join(this.dir, "credentials.json");
    this.locksDir = path.join(this.dir, "bots-runtime-locks", "telegram-polling");
    this.watchTimer = null;
    this._lastMtime = 0;
  }

  start() {
    this._lastMtime = this._configMtime();
    this.watchTimer = setInterval(() => {
      const m = this._configMtime();
      if (m !== this._lastMtime) {
        this._lastMtime = m;
        this.events.emit("refresh", { scope: "bots" });
      }
    }, 3_000);
  }

  stop() {
    clearInterval(this.watchTimer);
  }

  _configMtime() {
    try { return fs.statSync(this.configPath).mtimeMs; } catch { return 0; }
  }

  _readJson(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return fallback;
    }
  }

  _writeJson(file, data) {
    // атомарная запись: tmp + rename, чтобы ZCode не прочитал половину файла
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomBytes(4).toString("hex")}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, file);
  }

  _readConfig() {
    const cfg = this._readJson(this.configPath, null);
    if (!cfg || !Array.isArray(cfg.bots)) throw new Error("bot-config.v3.json не найден или повреждён");
    return cfg;
  }

  _pollingActive() {
    try {
      return fs.readdirSync(this.locksDir).filter((f) => f.endsWith(".lock")).length > 0;
    } catch {
      return false;
    }
  }

  /* ---------- API ---------- */

  async listBots() {
    const cfg = this._readConfig();
    const state = this._readJson(this.statePath, { bots: {} });
    const polling = this._pollingActive();
    return {
      bots: cfg.bots.map((b) => {
        const st = state.bots?.[b.id];
        return {
          id: b.id,
          name: b.name || "",
          displayName: b.displayName || b.name || "Без имени",
          provider: b.provider || "telegram",
          providerUserId: b.providerUserId || null,
          enabled: !!b.enabled,
          running: !!b.enabled && polling,
          replyMode: b.replyMode || "assistant_changes",
          allowedWorkspaces: b.allowedWorkspaces || ["*"],
          allowedCommands: b.allowedCommands || {},
          workspacePath: st?.workspacePath || null,
          stateUpdatedAt: st?.updatedAt || null,
          linked: !!b.credentialRef,
        };
      }),
      polling,
    };
  }

  async updateBot({ id, patch }) {
    if (!id) throw new Error("Не указан id бота");
    const cfg = this._readConfig();
    const bot = cfg.bots.find((b) => b.id === id);
    if (!bot) throw new Error("Бот не найден");

    if (patch.enabled !== undefined) bot.enabled = !!patch.enabled;
    if (patch.name !== undefined) bot.name = String(patch.name).slice(0, 64);
    if (patch.replyMode !== undefined) {
      if (!REPLY_MODES.includes(patch.replyMode)) throw new Error("Неизвестный режим ответов");
      bot.replyMode = patch.replyMode;
    }
    if (patch.allowedWorkspaces !== undefined) {
      const w = patch.allowedWorkspaces;
      if (w === "*" || (Array.isArray(w) && w.every((x) => typeof x === "string" && x.length < 200))) {
        bot.allowedWorkspaces = w === "*" ? ["*"] : w;
      } else throw new Error("Некорректный список проектов");
    }
    if (patch.allowedCommands !== undefined) {
      const incoming = patch.allowedCommands || {};
      const clean = {};
      for (const key of BOT_COMMANDS) {
        if (key in incoming) clean[key] = !!incoming[key];
      }
      bot.allowedCommands = clean;
    }

    this._writeJson(this.configPath, cfg);
    this._lastMtime = this._configMtime();
    this.events.emit("refresh", { scope: "bots" });
    return { updated: id };
  }

  async deleteBot({ id }) {
    if (!id) throw new Error("Не указан id бота");
    const cfg = this._readConfig();
    const before = cfg.bots.length;
    cfg.bots = cfg.bots.filter((b) => b.id !== id);
    if (cfg.bots.length === before) throw new Error("Бот не найден");
    this._writeJson(this.configPath, cfg);

    // Токен удаляем из credentials.json без расшифровки — просто убираем ключ
    const creds = this._readJson(this.credentialsPath, null);
    if (creds && Object.prototype.hasOwnProperty.call(creds, `bot:${id}:credential`)) {
      delete creds[`bot:${id}:credential`];
      this._writeJson(this.credentialsPath, creds);
    }

    this._lastMtime = this._configMtime();
    this.events.emit("refresh", { scope: "bots" });
    return { deleted: id };
  }

  /* Проверка токена BotFather из мини-аппа: мост вызывает getMe.
     Сам ZCode шифрует токены своим ключом (enc:v1), поэтому привязка
     нового токена выполняется в панели Bots на ПК — здесь мы только
     проверяем токен и подсказываем имя бота. */
  async linkBot({ token }) {
    const t = String(token || "").trim();
    if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(t)) throw new Error("Токен не похож на формат BotFather");
    let me;
    try {
      const res = await fetch(`https://api.telegram.org/bot${t}/getMe`, { signal: AbortSignal.timeout(8_000) });
      me = await res.json();
    } catch {
      throw new Error("Не удалось связаться с api.telegram.org");
    }
    if (!me.ok) throw new Error("Telegram отклонил токен");
    const cfg = this._readConfig();
    const existing = cfg.bots.find((b) => String(b.providerUserId) === String(me.result.id));
    return {
      verified: true,
      username: me.result.username,
      displayName: me.result.first_name,
      alreadyLinked: !!existing,
      existingId: existing?.id ?? null,
      hint: existing
        ? "Этот бот уже привязан в ZCode."
        : "Токен проверен. Вставьте его один раз в панель Bots на компьютере — ZCode шифрует токены своим ключом, остальное управление доступно отсюда.",
    };
  }
}

export { REPLY_MODES, BOT_COMMANDS };
