/* Демо-режим для публичной витрины: тот же интерфейс и те же форматы данных,
   что отдаёт мост, но сгенерированные локально. Секретов не содержит. */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rndLatency = () => sleep(220 + Math.random() * 400);

const TITLES = [
  "Рефакторинг авторизации в API",
  "Telegram Mini App: панель управления",
  "Оптимизация медленных SQL-запросов",
  "Деплой статики на GitHub Pages",
  "Чиню flaky-тесты в CI",
  "Дизайн-система для дашборда",
  "Парсер логов с ротацией",
  "Обновление зависимостей (npm audit)",
  "Миграция на ESM",
];

const DIRS = [
  "~/projects/api-gateway",
  "~/projects/tg-control",
  "~/projects/analytics",
  "~/projects/website",
  "~/projects/core-lib",
];

const USER_LINES = [
  "Посмотри, почему тесты падают на CI",
  "Добавь эндпоинт для статистики",
  "Покажи, что поменялось с прошлого раза",
  "Сделай красивее — это лицо проекта",
  "Проверь зависимости и обнови minor-версии",
  "Найди все места с хардкодом путей",
];

const BOT_LINES = [
  "Готово: обновил модуль и прогнал тесты — 42 passed, 0 failed.",
  "Нашёл узкое место: N+1 запрос в списке сессий. Добавил батчинг, стало в 8 раз быстрее.",
  "Собрал проект без ошибок. Ворнинги линтера поправил по ходу дела.",
  "Добавил типы и покрыл новый код тестами. Покрытие выросло до 87%.",
  "Вынес конфигурацию в переменные окружения. Секретов в коде больше нет.",
  "Обновил README: добавил раздел про деплой и архитектурную схему.",
];

const TODO_POOL = [
  ["Спроектировать структуру API", "completed", "high"],
  ["Написать клиент с автопереподключением", "completed", "medium"],
  ["Сверстать главный экран", "in_progress", "high"],
  ["Подключить WebSocket-события", "pending", "medium"],
  ["Написать README и схему деплоя", "pending", "low"],
];

const TOOL_NAMES = ["Read", "Edit", "Bash", "Grep", "Glob", "Write", "TodoWrite"];

function pick(arr, rnd) {
  return arr[Math.floor(rnd() * arr.length)];
}

export class DemoClient {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.status = "offline";
    this.sessions = [];
    this.timer = null;
    this.disposed = false;
  }

  _setStatus(s) {
    this.status = s;
    this.handlers.onStatus?.(s);
  }

  _emit(scope, id) {
    this.handlers.onEvent?.({ type: "refresh", scope, id });
  }

  async connect() {
    this.disposed = false;
    this._buildDataset();
    this._buildBots();
    this._scheduleTick();
    this._setStatus("demo");
    return { ok: true, user: { first_name: "Demo" }, mode: "demo" };
  }

  disconnect() {
    this.disposed = true;
    clearTimeout(this.timer);
    this._setStatus("offline");
  }

  /* ---------- боты (демо) ---------- */

  _buildBots() {
    this.demoBots = [{
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
      workspacePath: "~/projects/api-gateway",
      stateUpdatedAt: Date.now() - 300_000,
      linked: true,
    }];
  }

  async bots() {
    await rndLatency();
    return { bots: this.demoBots, polling: this.demoBots.some((b) => b.enabled) };
  }

  async botUpdate(id, patch) {
    await rndLatency();
    const b = this.demoBots.find((x) => x.id === id);
    if (!b) throw new Error("Бот не найден");
    if (patch.enabled !== undefined) { b.enabled = !!patch.enabled; b.running = b.enabled && b.running; }
    if (patch.name !== undefined) b.name = String(patch.name).slice(0, 64);
    if (patch.replyMode !== undefined) b.replyMode = patch.replyMode;
    if (patch.allowedWorkspaces !== undefined) b.allowedWorkspaces = patch.allowedWorkspaces === "*" ? ["*"] : patch.allowedWorkspaces;
    if (patch.allowedCommands !== undefined) b.allowedCommands = { ...b.allowedCommands, ...patch.allowedCommands };
    this._emit("bots");
    return { updated: id };
  }

  async botDelete(id) {
    await rndLatency();
    const before = this.demoBots.length;
    this.demoBots = this.demoBots.filter((x) => x.id !== id);
    if (this.demoBots.length === before) throw new Error("Бот не найден");
    this._emit("bots");
    return { deleted: id };
  }

  async botLink(token) {
    await rndLatency();
    const t = String(token || "").trim();
    if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(t)) throw new Error("Токен не похож на формат BotFather");
    return {
      verified: true,
      username: "demo_helper_bot",
      displayName: "Demo Helper",
      alreadyLinked: this.demoBots.length > 0,
      existingId: this.demoBots[0]?.id ?? null,
      hint: "Демо: токен проверен по формату, без реального вызова Telegram.",
    };
  }

  async projects() {
    await rndLatency();
    return { projects: DIRS.map((d, i) => ({ id: `proj_demo_${i}`, directory: d })) };
  }

  _buildDataset() {
    const rnd = mulberry32(20261028);
    const now = Date.now();
    this.sessions = TITLES.map((title, i) => {
      const created = now - (i + 1) * 26 * 3600_000 - rnd() * 4 * 3600_000;
      const updated = i === 0 ? now - 2 * 60_000 : now - (i + 1) * 9 * 3600_000 - rnd() * 6 * 3600_000;
      const outcome = i === 0 ? null : pick(["completed", "completed", "interrupted", null], rnd);
      const todos = outcome === null
        ? TODO_POOL.map(([content, status, priority]) => ({ content, status, priority }))
        : [];
      return {
        id: `demo_s${i}`,
        title,
        directory: pick(DIRS, rnd),
        timeCreated: created,
        timeUpdated: updated,
        outcome,
        tokens: 40_000 + Math.floor(rnd() * 360_000),
        additions: Math.floor(rnd() * 800),
        deletions: Math.floor(rnd() * 300),
        todos,
        messages: buildMessages(rnd, updated, i === 0 ? 9 : 5 + Math.floor(rnd() * 4)),
        tools: buildTools(rnd),
      };
    });
  }

  _scheduleTick() {
    const tick = () => {
      if (this.disposed) return;
      this._mutate();
      this.timer = setTimeout(tick, 5_000 + Math.random() * 4_000);
    };
    this.timer = setTimeout(tick, 4_500);
  }

  _mutate() {
    const live = this.sessions[0];
    const r = Math.random();
    if (r < 0.55) {
      live.messages.push({
        id: `demo_m${Date.now()}`,
        role: Math.random() < 0.4 ? "user" : "assistant",
        time: Date.now(),
        text: Math.random() < 0.4 ? pick(USER_LINES, Math.random) : pick(BOT_LINES, Math.random),
        more: false,
      });
      if (live.messages.length > 14) live.messages.shift();
      live.timeUpdated = Date.now();
      this._emit("overview");
      this._emit("session", live.id);
    } else if (r < 0.85 && live.todos.length) {
      const t = live.todos.find((x) => x.status === "pending") || live.todos[0];
      if (t.status === "pending") t.status = "in_progress";
      else t.status = "completed";
      this._emit("overview");
      this._emit("session", live.id);
    } else {
      live.tokens += Math.floor(Math.random() * 3_000);
      this._emit("overview");
      this._emit("sessions");
    }
  }

  async overview() {
    await rndLatency();
    const s = this.sessions[0];
    const active = Date.now() - s.timeUpdated < 5 * 60_000;
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const activity = this.sessions
      .flatMap((sess) => sess.messages.slice(-2).map((m) => ({
        sessionId: sess.id,
        sessionTitle: sess.title,
        time: m.time,
        text: m.text,
      })))
      .sort((a, b) => b.time - a.time)
      .slice(0, 6);
    return {
      status: {
        state: active ? "active" : "idle",
        model: "GLM-5.3-Flash",
        mode: "yolo",
        updatedAt: s.timeUpdated,
        session: { id: s.id, title: s.title },
      },
      stats: {
        sessions: this.sessions.length,
        sessionsToday: this.sessions.filter((x) => x.timeCreated >= todayStart).length + 1,
        tokensToday: this.sessions.reduce((acc, x) => acc + (x.timeUpdated >= todayStart ? x.tokens : 0), 0),
        todosActive: this.sessions.reduce((acc, x) => acc + x.todos.filter((t) => t.status === "in_progress").length, 0),
      },
      activity,
    };
  }

  async sessions() {
    await rndLatency();
    return {
      sessions: this.sessions.map((s) => ({
        id: s.id,
        title: s.title,
        directory: s.directory,
        timeUpdated: s.timeUpdated,
        outcome: s.outcome,
        tokens: s.tokens,
      })),
    };
  }

  async sessionDetail(id) {
    await rndLatency();
    const s = this.sessions.find((x) => x.id === id);
    if (!s) throw new Error("Сессия не найдена");
    return {
      session: {
        id: s.id, title: s.title, directory: s.directory,
        timeCreated: s.timeCreated, timeUpdated: s.timeUpdated,
        outcome: s.outcome, additions: s.additions, deletions: s.deletions,
        tokens: s.tokens,
      },
      todos: s.todos,
      messages: s.messages,
      tools: s.tools,
    };
  }

  async search(q, limit = 20) {
    await rndLatency();
    const needle = String(q).toLowerCase();
    const results = [];
    for (const s of this.sessions) {
      for (const m of s.messages) {
        if (results.length >= limit) break;
        const idx = m.text.toLowerCase().indexOf(needle);
        if (idx >= 0) {
          results.push({
            sessionId: s.id,
            sessionTitle: s.title,
            time: m.time,
            text: m.text.slice(Math.max(0, idx - 60), idx + 120),
          });
        }
      }
    }
    return { results };
  }

  async stats() {
    await rndLatency();
    const rnd = mulberry32(7);
    const daily = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      const weekend = [0, 6].includes(d.getDay());
      daily.push({
        date: d.toISOString().slice(0, 10),
        tokens: Math.floor((weekend ? 30_000 : 90_000) + rnd() * 160_000),
        sessions: Math.floor(rnd() * 5) + (weekend ? 0 : 2),
      });
    }
    return {
      daily,
      models: [
        { model: "GLM-5.3-Flash", tokens: 1_820_000, runs: 214 },
        { model: "GLM-4.6", tokens: 640_000, runs: 58 },
      ],
      tools: [
        { name: "Read", count: 412 },
        { name: "Edit", count: 236 },
        { name: "Bash", count: 198 },
        { name: "Grep", count: 121 },
        { name: "TodoWrite", count: 64 },
      ],
    };
  }
}

function buildMessages(rnd, lastTime, count) {
  const msgs = [];
  let t = lastTime - count * 7 * 60_000;
  for (let i = 0; i < count; i++) {
    t += (2 + rnd() * 9) * 60_000;
    msgs.push({
      id: `demo_m${Math.floor(rnd() * 1e9)}`,
      role: rnd() < 0.35 ? "user" : "assistant",
      time: Math.min(t, lastTime),
      text: rnd() < 0.35 ? pick(USER_LINES, rnd) : pick(BOT_LINES, rnd),
      more: false,
    });
  }
  return msgs;
}

function buildTools(rnd) {
  return [...TOOL_NAMES]
    .sort(() => rnd() - 0.5)
    .slice(0, 5)
    .map((name) => ({ name, count: 4 + Math.floor(rnd() * 40), avgMs: 40 + Math.floor(rnd() * 900) }));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
