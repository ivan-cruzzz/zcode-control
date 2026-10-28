/* Демо-адаптер моста: имитирует данные ZCODE, чтобы мост можно было
   проверить без установленного ZCODE (npm run demo). Форматы — 1-в-1
   с адаптером ZcodeAdapter. Секретов не содержит. */

import { EventEmitter } from "node:events";

const TITLES = [
  "Рефакторинг авторизации в API",
  "Telegram Mini App: панель управления",
  "Оптимизация медленных SQL-запросов",
  "Деплой статики на GitHub Pages",
  "Чиню flaky-тесты в CI",
  "Дизайн-система для дашборда",
];
const DIRS = ["~/projects/api-gateway", "~/projects/tg-control", "~/projects/analytics"];
const LINES = [
  "Готово: обновил модуль и прогнал тесты — 42 passed, 0 failed.",
  "Нашёл узкое место: N+1 запрос в списке сессий. Исправлено.",
  "Собрал проект без ошибок, поправил ворнинги линтера.",
  "Вынес конфигурацию в переменные окружения. Секретов в коде нет.",
  "Посмотри, почему тесты падают на CI",
  "Добавь эндпоинт для статистики",
];
const TODOS = [
  ["Спроектировать структуру API", "completed", "high"],
  ["Написать клиент с автопереподключением", "completed", "medium"],
  ["Сверстать главный экран", "in_progress", "high"],
  ["Подключить WebSocket-события", "pending", "medium"],
];
const TOOLS = [["Read", 31], ["Edit", 18], ["Bash", 12], ["Grep", 7]];

export class DemoAdapter {
  constructor() {
    this.mode = "demo";
    this.events = new EventEmitter();
    this.sessions = [];
    this.timer = null;
  }

  start() {
    const now = Date.now();
    this.sessions = TITLES.map((title, i) => ({
      id: `demo_s${i}`,
      title,
      directory: DIRS[i % DIRS.length],
      timeCreated: now - (i + 1) * 26 * 3600_000,
      timeUpdated: i === 0 ? now - 60_000 : now - (i + 1) * 9 * 3600_000,
      outcome: i === 0 ? null : ["completed", "interrupted", null][i % 3],
      tokens: 50_000 + i * 30_000,
      additions: 120 + i * 40,
      deletions: 30 + i * 10,
      todos: TODOS.map(([content, status, priority]) => ({ content, status, priority })),
      messages: Array.from({ length: 6 }, (_, k) => ({
        id: `demo_m${i}_${k}`,
        role: k % 3 === 0 ? "user" : "assistant",
        time: now - (6 - k) * 5 * 60_000,
        text: LINES[(i + k) % LINES.length],
        more: false,
      })),
      tools: TOOLS.map(([name, count]) => ({ name, count, avgMs: 120 + i * 30 })),
    }));

    this.demoBots = [
      {
        id: "demo_bot1",
        name: "",
        displayName: "Demo Helper",
        provider: "telegram",
        providerUserId: "7000000001",
        enabled: true,
        running: true,
        replyMode: "assistant_changes",
        allowedWorkspaces: ["*"],
        allowedCommands: { status: true, new: true, workspace: true, model: true, mode: true, thoughtLevel: true, reply: true },
        workspacePath: DIRS[0],
        stateUpdatedAt: now,
        linked: true,
      },
    ];

    this.timer = setInterval(() => {
      const live = this.sessions[0];
      const r = Math.random();
      if (r < 0.5) {
        live.messages.push({
          id: `demo_m${Date.now()}`,
          role: Math.random() < 0.4 ? "user" : "assistant",
          time: Date.now(),
          text: LINES[Math.floor(Math.random() * LINES.length)],
          more: false,
        });
        if (live.messages.length > 14) live.messages.shift();
        live.timeUpdated = Date.now();
        this.events.emit("refresh", { scope: "overview" });
        this.events.emit("refresh", { scope: "session", id: live.id });
      } else if (r < 0.85) {
        const t = live.todos.find((x) => x.status === "pending");
        if (t) t.status = "in_progress";
        else live.todos.forEach((x) => { if (x.status === "in_progress") x.status = "completed"; });
        this.events.emit("refresh", { scope: "overview" });
        this.events.emit("refresh", { scope: "session", id: live.id });
      } else {
        live.tokens += Math.floor(Math.random() * 2_500);
        this.events.emit("refresh", { scope: "overview" });
        this.events.emit("refresh", { scope: "sessions" });
      }
    }, 5_000);
  }

  stop() {
    clearInterval(this.timer);
  }

  /* ---------- боты (демо-версия управления) ---------- */

  async bots() {
    return { bots: this.demoBots, polling: this.demoBots.some((b) => b.enabled) };
  }

  async botUpdate({ id, patch }) {
    const b = this.demoBots.find((x) => x.id === id);
    if (!b) throw new Error("Бот не найден");
    if (patch.enabled !== undefined) { b.enabled = !!patch.enabled; b.running = b.enabled && b.running; }
    if (patch.name !== undefined) b.name = String(patch.name).slice(0, 64);
    if (patch.replyMode !== undefined) b.replyMode = patch.replyMode;
    if (patch.allowedWorkspaces !== undefined) b.allowedWorkspaces = patch.allowedWorkspaces === "*" ? ["*"] : patch.allowedWorkspaces;
    if (patch.allowedCommands !== undefined) b.allowedCommands = { ...b.allowedCommands, ...patch.allowedCommands };
    this.events.emit("refresh", { scope: "bots" });
    return { updated: id };
  }

  async botDelete({ id }) {
    const before = this.demoBots.length;
    this.demoBots = this.demoBots.filter((x) => x.id !== id);
    if (this.demoBots.length === before) throw new Error("Бот не найден");
    this.events.emit("refresh", { scope: "bots" });
    return { deleted: id };
  }

  async botLink({ token }) {
    const t = String(token || "").trim();
    if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(t)) throw new Error("Токен не похож на формат BotFather");
    const exists = this.demoBots.find((b) => b.providerUserId === "7000000001");
    return {
      verified: true,
      username: "demo_helper_bot",
      displayName: "Demo Helper",
      alreadyLinked: !!exists,
      existingId: exists?.id ?? null,
      hint: "Демо: токен проверен по формату, реальный вызов Telegram выполняет только мост.",
    };
  }

  async projects() {
    return { projects: DIRS.map((d, i) => ({ id: `proj_demo_${i}`, directory: d })) };
  }

  async setupStatus() {
    return {
      bridge: { ok: true, mode: "demo", dbOk: true },
      ownerPaired: true,
      bot: {
        verified: true,
        id: "7000000001",
        username: "demo_helper_bot",
        displayName: "Demo Helper",
        linkedInZcode: false,
        enabledInZcode: false,
        polling: false,
      },
    };
  }

  async overview() {
    const s = this.sessions[0];
    return {
      status: {
        state: "active",
        model: "GLM-5.3-Flash",
        mode: "yolo",
        updatedAt: s.timeUpdated,
        session: { id: s.id, title: s.title },
      },
      stats: {
        sessions: this.sessions.length,
        sessionsToday: 2,
        tokensToday: this.sessions.reduce((a, x) => a + x.tokens, 0) % 250_000,
        todosActive: this.sessions.reduce(
          (a, x) => a + x.todos.filter((t) => t.status === "in_progress").length, 0),
      },
      activity: this.sessions
        .flatMap((sess) => sess.messages.slice(-1).map((m) => ({
          sessionId: sess.id, sessionTitle: sess.title, time: m.time, text: m.text,
        })))
        .sort((a, b) => b.time - a.time)
        .slice(0, 6),
    };
  }

  async sessions({ limit = 40 } = {}) {
    return {
      sessions: this.sessions.slice(0, limit).map(({ id, title, directory, timeUpdated, outcome, tokens }) => ({
        id, title, directory, timeUpdated, outcome, tokens,
      })),
    };
  }

  async sessionDetail({ id }) {
    const s = this.sessions.find((x) => x.id === id);
    if (!s) throw new Error("Сессия не найдена");
    return {
      session: {
        id: s.id, title: s.title, directory: s.directory,
        timeCreated: s.timeCreated, timeUpdated: s.timeUpdated,
        outcome: s.outcome, additions: s.additions, deletions: s.deletions, tokens: s.tokens,
      },
      todos: s.todos,
      messages: [...s.messages].sort((a, b) => a.time - b.time),
      tools: s.tools,
    };
  }

  async search({ q, limit = 20 }) {
    const needle = String(q).toLowerCase();
    const results = [];
    for (const s of this.sessions) {
      for (const m of s.messages) {
        if (results.length >= limit) break;
        const idx = m.text.toLowerCase().indexOf(needle);
        if (idx >= 0) {
          results.push({
            sessionId: s.id, sessionTitle: s.title, time: m.time,
            text: m.text.slice(Math.max(0, idx - 60), idx + needle.length + 120),
          });
        }
      }
    }
    return { results };
  }

  async stats({ days = 7 } = {}) {
    const daily = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      daily.push({
        date: d.toISOString().slice(0, 10),
        tokens: 40_000 + Math.round(Math.random() * 160_000),
        sessions: 1 + Math.floor(Math.random() * 4),
      });
    }
    return {
      daily,
      models: [
        { model: "GLM-5.3-Flash", tokens: 1_240_000, runs: 87 },
        { model: "GLM-4.6", tokens: 310_000, runs: 21 },
      ],
      tools: TOOLS.map(([name, count]) => ({ name, count })),
    };
  }
}
