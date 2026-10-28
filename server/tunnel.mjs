/* Настоящее подключение «из коробки»:
   1) мост сам поднимает quick-туннель cloudflared и ловит его HTTPS-адрес;
   2) ловит /start в боте (getUpdates) — первый написавший становится чатом владельца;
   3) присылает в чат кнопку «Открыть ZCODE Control» с адресом туннеля внутри
      (t.me/<bot>?startapp=<base64url(url)>) — мини-апп откроется уже подключённым.
   Если панель Bots ZCode начнёт опрашивать того же бота (конфликт 409), наш
   опрос автоматически уступает дорогу — туннель при этом продолжает работать. */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function b64url(s) {
  return Buffer.from(s, "utf8").toString("base64url");
}

/* ---------------- Туннель ---------------- */

export class Tunnel {
  constructor({ port, bin }) {
    this.port = port;
    this.bin = bin;
    this.url = null;
    this.proc = null;
    this.stopped = false;
  }

  start() {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => {
        if (!settled) { settled = true; resolve(v); }
      };
      try {
        this.proc = spawn(
          this.bin,
          ["tunnel", "--url", `http://127.0.0.1:${this.port}`, "--no-autoupdate"],
          { windowsHide: true },
        );
        const onData = (buf) => {
          const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
          if (m && !this.url) {
            this.url = m[0];
            finish(this.url);
          }
        };
        this.proc.stdout?.on("data", onData);
        this.proc.stderr?.on("data", onData);
        this.proc.on("exit", () => {
          this.url = null;
          if (!this.stopped) {
            setTimeout(() => this.start(), 5_000); // туннель умер — поднимаем заново
          }
        });
      } catch {
        finish(null);
        return;
      }
      setTimeout(() => finish(this.url), 30_000);
    });
  }

  stop() {
    this.stopped = true;
    try { this.proc?.kill(); } catch { /* noop */ }
  }
}

/* ---------------- Связка с ботом ---------------- */

export class BotLink {
  constructor({ token, dir, log = () => {} }) {
    this.token = token;
    this.dir = dir;
    this.log = log;
    this.chatFile = path.join(dir, ".tg-chat.json");
    this.offsetFile = path.join(dir, ".tg-offset");
    this.chatId = null;
    this.running = false;
    this.conflict = false;
    this.pendingUrl = null;
    try { this.chatId = JSON.parse(fs.readFileSync(this.chatFile, "utf8")).chatId ?? null; } catch { /* ещё не связано */ }
  }

  get paired() { return this.chatId != null; }

  async api(method, body, timeoutMs = 35_000) {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.json();
  }

  startPolling() {
    if (this.running) return;
    this.running = true;
    const loop = async () => {
      while (this.running) {
        try {
          const offset = this.readOffset();
          const j = await this.api("getUpdates", { timeout: 25, offset, allowed_updates: ["message", "callback_query", "pre_checkout_query"] });
          if (!j.ok) {
            if (j.error_code === 409) {
              // того же бота опрашивает кто-то ещё (например, панель Bots ZCode) — уступаем
              this.conflict = true;
              this.running = false;
              this.log("getUpdates: конфликт 409 — опрос остановлен (бот обслуживается ZCode), туннель продолжает работать");
              return;
            }
            await new Promise((r) => setTimeout(r, 5_000));
            continue;
          }
          for (const u of j.result || []) {
            this.writeOffset(u.update_id + 1);
            if (u.callback_query) await this.onCallback?.(u.callback_query);
            const msg = u.message;
            if (msg?.chat?.id) {
              // закрепление чата владельца остаётся здесь; обработка — в onMessage
              if (this.chatId == null) {
                this.chatId = msg.chat.id;
                try { fs.writeFileSync(this.chatFile, JSON.stringify({ chatId: msg.chat.id, at: Date.now() })); } catch { /* noop */ }
                this.log(`чат владельца закреплён: ${msg.chat.id}`);
              }
              if (msg.chat.id === this.chatId && this.onMessage) await this.onMessage(msg);
              else if (!this.onMessage) await this.handleMessage(msg); // легаси-режим без обработчика
            }
          }
        } catch {
          await new Promise((r) => setTimeout(r, 3_000));
        }
      }
    };
    loop();
  }

  readOffset() {
    try { return Number(fs.readFileSync(this.offsetFile, "utf8").trim()) || 0; } catch { return 0; }
  }
  writeOffset(v) {
    try { fs.writeFileSync(this.offsetFile, String(v)); } catch { /* noop */ }
  }

  async handleMessage(msg) {
    const chatId = msg.chat.id;
    if (this.chatId == null) {
      // первый написавший становится чатом владельца моста
      this.chatId = chatId;
      try { fs.writeFileSync(this.chatFile, JSON.stringify({ chatId, at: Date.now() })); } catch { /* noop */ }
      this.log(`чат владельца закреплён: ${chatId}`);
    }
    if (chatId !== this.chatId) return; // чужие не обслуживаем
    if (this.pendingUrl && msg.text === "/start") {
      await this.sendLaunch(chatId, this.pendingUrl);
    }
  }

  async sendLaunch(chatId, url) {
    let username = null;
    try {
      const me = await this.api("getMe", {}, 8_000);
      if (me.ok) username = me.result.username;
    } catch { /* повторим при следующем анонсе */ }
    if (!username) {
      this.log("getMe не удался — кнопку не отправил, повторится при следующем туннеле");
      return;
    }
    const link = `https://t.me/${username}?startapp=${b64url(url)}`;
    await this.api("sendMessage", {
      chat_id: chatId,
      text: `Мост ZCODE Control поднят.\nТапните кнопку — мини-апп откроется уже подключённым.\nРезерв: впишите ${url} в Настройках.`,
      reply_markup: { inline_keyboard: [[{ text: "Открыть ZCODE Control", url: link }]] },
    }, 10_000);
  }

  /** Вызывается мостом, когда туннель поднялся: если чат уже известен — шлём кнопку сразу. */
  async announce(url) {
    this.pendingUrl = url;
    if (this.paired) await this.sendLaunch(this.chatId, url);
  }

  stop() {
    this.running = false;
  }
}
