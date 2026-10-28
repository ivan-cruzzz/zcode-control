/* Клиент моста (HTTPS + WS) и демо-клиент. Порт vanilla-версии в TS. */

const REQUEST_TIMEOUT = 12_000;
const BACKOFF = [1_000, 2_000, 4_000, 8_000, 15_000];

export type ClientStatus = "connecting" | "online" | "offline" | "demo";

export interface SessionItem {
  id: string; title: string; directory: string;
  timeUpdated: number; outcome: string | null; tokens: number;
}
export interface SetupState {
  bridge: { ok: boolean; mode: string; dbOk: boolean };
  ownerPaired: boolean;
  billing?: { pro: boolean; freeMinutes: number };
  tunnel?: { url: string | null; botChatPaired: boolean; botConflict: boolean };
  bot: {
    verified: boolean; id: string | null; username: string | null; displayName: string | null;
    linkedInZcode: boolean; enabledInZcode: boolean; polling: boolean;
  };
}
export interface BotItem {
  id: string; name: string; displayName: string; provider: string; providerUserId: string | null;
  enabled: boolean; running: boolean; replyMode: string;
  allowedWorkspaces: string[]; allowedCommands: Record<string, boolean>;
  workspacePath: string | null; stateUpdatedAt: number | null; linked: boolean;
}

export interface ClientHandlers {
  onStatus?: (s: ClientStatus) => void;
  onEvent?: (e: { type: string; scope?: string; id?: string }) => void;
}

async function postJson<T = any>(url: string, body: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export class BridgeClient {
  status: ClientStatus = "offline";
  mode = "zcode";
  user: any = null;
  pairing = false;
  ownerMatch: boolean | null = null;
  private baseUrl = "";
  private initData = "";
  private ws: WebSocket | null = null;
  private disposed = false;
  private wsFailures = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private handlers: ClientHandlers = {}) {}

  private setStatus(s: ClientStatus) {
    if (this.status === s) return;
    this.status = s;
    this.handlers.onStatus?.(s);
  }
  private emit(e: { type: string; scope?: string; id?: string }) {
    this.handlers.onEvent?.(e);
  }

  setUrl(url: string) {
    this.baseUrl = url.trim().replace(/\/+$/, "");
  }

  async connect(initData: string) {
    this.disposed = false;
    this.initData = initData;
    if (!this.baseUrl) throw new Error("Адрес моста не задан");
    if (this.baseUrl.startsWith("http:")) throw new Error("Нужен HTTPS-адрес");
    this.setStatus("connecting");
    let res: any;
    try {
      res = await postJson(`${this.baseUrl}/api/auth`, { initData });
    } catch (err) {
      this.setStatus("offline");
      throw err;
    }
    this.user = res.user ?? null;
    this.mode = res.mode ?? "zcode";
    this.pairing = !!res.pairing;
    this.ownerMatch = res.ownerMatch ?? null;
    if (this.pairing) {
      this.setStatus("online");
      return { pairing: true as const };
    }
    if (this.ownerMatch === false) {
      this.setStatus("offline");
      return { ownerMismatch: true as const };
    }
    this.openWs();
    return {};
  }

  private openWs() {
    if (this.disposed) return;
    try {
      const ws = new WebSocket(this.baseUrl.replace(/^http/, "ws") + "/ws");
      this.ws = ws;
      const authTimer = setTimeout(() => ws.close(), 8_000);
      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", initData: this.initData }));
      ws.onmessage = (e) => {
        let msg: any;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === "auth_ok") {
          clearTimeout(authTimer);
          this.wsFailures = 0;
          this.stopPolling();
          this.setStatus("online");
          this.emit({ type: "refresh", scope: "all" });
        } else if (msg.type === "auth_fail") {
          clearTimeout(authTimer);
          ws.close();
          this.setStatus("offline");
        } else if (msg.type === "refresh") {
          this.emit(msg);
        }
      };
      ws.onclose = () => {
        clearTimeout(authTimer);
        if (this.disposed) return;
        this.ws = null;
        this.scheduleReconnect();
      };
      ws.onerror = () => ws.close();
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.disposed) return;
    const delay = BACKOFF[Math.min(this.wsFailures, BACKOFF.length - 1)];
    this.wsFailures += 1;
    if (this.wsFailures >= 2 && this.status !== "offline") this.startPolling();
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.openWs(), delay);
  }

  private startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.emit({ type: "refresh", scope: "all" }), 12_000);
  }
  private stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  disconnect() {
    this.disposed = true;
    clearTimeout(this.reconnectTimer);
    this.stopPolling();
    try { this.ws?.close(); } catch { /* noop */ }
    this.ws = null;
    this.setStatus("offline");
  }

  reconnectNow() {
    if (this.disposed || !this.baseUrl) return;
    this.wsFailures = 0;
    this.connect(this.initData).catch(() => {});
  }

  overview() { return postJson(`${this.baseUrl}/api/overview`, { initData: this.initData }); }
  sessions(limit = 40) { return postJson(`${this.baseUrl}/api/sessions`, { initData: this.initData, limit }); }
  sessionDetail(id: string) { return postJson(`${this.baseUrl}/api/session`, { initData: this.initData, id }); }
  sessionSend(id: string, text: string) { return postJson(`${this.baseUrl}/api/session/send`, { initData: this.initData, id, text }); }
  search(q: string, limit = 12) { return postJson(`${this.baseUrl}/api/search`, { initData: this.initData, q, limit }); }
  stats(days = 7) { return postJson(`${this.baseUrl}/api/stats`, { initData: this.initData, days }); }
  bots() { return postJson(`${this.baseUrl}/api/bots`, { initData: this.initData }); }
  botUpdate(id: string, patch: unknown) { return postJson(`${this.baseUrl}/api/bot/update`, { initData: this.initData, id, patch }); }
  botDelete(id: string) { return postJson(`${this.baseUrl}/api/bot/delete`, { initData: this.initData, id }); }
  botLink(token: string) { return postJson(`${this.baseUrl}/api/bot/link`, { initData: this.initData, token }); }
  projects() { return postJson(`${this.baseUrl}/api/projects`, { initData: this.initData }); }
  pair() { return postJson(`${this.baseUrl}/api/pair`, { initData: this.initData }); }
  setup() { return postJson(`${this.baseUrl}/api/setup`, { initData: this.initData }); }
}

/* ---------------- Демо-клиент (витрина без моста) ---------------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = () => Math.random();
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];

const TITLES = ["Рефакторинг авторизации в API", "Telegram Mini App: панель управления", "Оптимизация SQL-запросов", "Деплой на GitHub Pages", "Чиню flaky-тесты в CI", "Дизайн-система для дашборда"];
const DIRS = ["~/projects/api-gateway", "~/projects/tg-control", "~/projects/analytics"];
const LINES = ["Готово: обновил модуль, тесты — 42 passed.", "Нашёл N+1 запрос, исправлено.", "Собрал проект без ошибок.", "Секреты вынесены в .env."];

export class DemoClient {
  status: ClientStatus = "offline";
  mode = "demo";
  user: any = null;
  pairing = false;
  ownerMatch = null;
  private sessions: any[] = [];
  private bots: BotItem[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private handlers: ClientHandlers = {}) {}

  private setStatus(s: ClientStatus) { this.status = s; this.handlers.onStatus?.(s); }
  private emit(scope: string, id?: string) { this.handlers.onEvent?.({ type: "refresh", scope, id }); }

  async connect() {
    this.disposed = false;
    this.build();
    this.tick();
    this.setStatus("demo");
    return {};
  }
  disconnect() { this.disposed = true; if (this.timer) clearTimeout(this.timer); this.setStatus("offline"); }
  reconnectNow() { /* демо всегда жив */ }

  private build() {
    const now = Date.now();
    this.sessions = TITLES.map((title, i) => ({
      id: `demo_s${i}`, title, directory: DIRS[i % DIRS.length],
      timeCreated: now - (i + 1) * 26 * 3600_000,
      timeUpdated: i === 0 ? now - 2 * 60_000 : now - (i + 1) * 9 * 3600_000,
      outcome: i === 0 ? null : pick(["completed", "completed", "interrupted", null]),
      tokens: 40_000 + Math.floor(rnd() * 360_000),
      additions: Math.floor(rnd() * 800), deletions: Math.floor(rnd() * 300),
      todos: i === 0
        ? [
            { content: "Спроектировать структуру API", status: "completed", priority: "high" },
            { content: "Сверстать главный экран", status: "in_progress", priority: "high" },
            { content: "Подключить WebSocket", status: "pending", priority: "medium" },
          ]
        : [],
      messages: Array.from({ length: 6 }, (_, k) => ({
        id: `m${i}${k}`, role: k % 3 === 0 ? "user" : "assistant",
        time: now - (6 - k) * 5 * 60_000, text: pick(LINES), more: false,
      })),
      tools: [["Read", 21], ["Edit", 14], ["Bash", 9]].map(([n, c]) => ({ name: n, count: c, avgMs: 120 })),
    }));
    this.bots = [{
      id: "demo_bot1", name: "", displayName: "Demo Helper", provider: "telegram",
      providerUserId: "7000000001", enabled: true, running: true, replyMode: "assistant_changes",
      allowedWorkspaces: ["*"], allowedCommands: { status: true, new: true },
      workspacePath: DIRS[0], stateUpdatedAt: now, linked: true,
    }];
  }

  private tick() {
    const t = () => {
      if (this.disposed) return;
      const live = this.sessions[0];
      live.messages.push({ id: `m${Date.now()}`, role: rnd() < 0.4 ? "user" : "assistant", time: Date.now(), text: pick(LINES), more: false });
      if (live.messages.length > 14) live.messages.shift();
      live.timeUpdated = Date.now();
      this.emit("overview");
      this.emit("session", live.id);
      this.timer = setTimeout(t, 6_000 + rnd() * 4_000);
    };
    this.timer = setTimeout(t, 5_000);
  }

  async overview() {
    await sleep(250 + rnd() * 350);
    const s = this.sessions[0];
    return {
      status: { state: "active", model: "GLM-5.3-Flash", mode: "yolo", updatedAt: s.timeUpdated, session: { id: s.id, title: s.title } },
      stats: {
        sessions: this.sessions.length,
        sessionsToday: 2,
        tokensToday: 128_867,
        todosActive: 1,
      },
      activity: this.sessions.flatMap((x) => x.messages.slice(-1).map((m: any) => ({ sessionId: x.id, sessionTitle: x.title, time: m.time, text: m.text }))).slice(0, 6),
    };
  }
  async sessions() {
    await sleep(250);
    return { sessions: this.sessions.map(({ id, title, directory, timeUpdated, outcome, tokens }: any) => ({ id, title, directory, timeUpdated, outcome, tokens })) };
  }
  async sessionDetail(id: string) {
    await sleep(250);
    const s = this.sessions.find((x) => x.id === id);
    if (!s) throw new Error("Сессия не найдена");
    return { session: s, todos: s.todos, messages: s.messages, tools: s.tools };
  }
  async sessionSend(id: string, text: string) {
    await sleep(300);
    const s = this.sessions.find((x) => x.id === id);
    if (!s) throw new Error("Сессия не найдена");
    s.messages.push({ id: `m${Date.now()}`, role: "user", time: Date.now(), text, more: false });
    this.emit("session", id);
    return { sent: true };
  }
  async search(q: string) {
    await sleep(250);
    const needle = q.toLowerCase();
    const results: any[] = [];
    for (const s of this.sessions) for (const m of s.messages) {
      const i = m.text.toLowerCase().indexOf(needle);
      if (i >= 0 && results.length < 12) results.push({ sessionId: s.id, sessionTitle: s.title, time: m.time, text: m.text.slice(Math.max(0, i - 40), i + 100) });
    }
    return { results };
  }
  async stats() {
    await sleep(250);
    const daily = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.now() - (6 - i) * 86_400_000);
      return { date: d.toISOString().slice(0, 10), tokens: Math.floor(40_000 + rnd() * 160_000), sessions: Math.floor(rnd() * 5) };
    });
    return {
      daily,
      models: [{ model: "GLM-5.3-Flash", tokens: 1_240_000, runs: 87 }, { model: "GLM-4.6", tokens: 310_000, runs: 21 }],
      tools: [{ name: "Read", count: 412 }, { name: "Edit", count: 236 }, { name: "Bash", count: 198 }],
    };
  }
  async bots() { await sleep(200); return { bots: this.bots, polling: this.bots.some((b) => b.enabled) }; }
  async botUpdate(id: string, patch: any) {
    const b = this.bots.find((x) => x.id === id);
    if (!b) throw new Error("Бот не найден");
    Object.assign(b, patch);
    b.running = b.enabled;
    this.emit("bots");
    return { updated: id };
  }
  async botDelete(id: string) { this.bots = this.bots.filter((b) => b.id !== id); this.emit("bots"); return { deleted: id }; }
  async botLink(token: string) {
    if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token.trim())) throw new Error("Токен не похож на формат BotFather");
    return { verified: true, username: "demo_helper_bot", displayName: "Demo Helper", alreadyLinked: this.bots.length > 0, existingId: this.bots[0]?.id ?? null, hint: "Демо" };
  }
  async projects() { await sleep(200); return { projects: DIRS.map((d, i) => ({ id: `proj_demo_${i}`, directory: d })) }; }
  async pair() { return { ok: true, paired: true, owner: { userId: 42 } }; }
  async setup() {
    await sleep(200);
    return {
      bridge: { ok: true, mode: "demo", dbOk: true },
      ownerPaired: true,
      billing: { pro: false, freeMinutes: 60 },
      tunnel: { url: "https://demo.trycloudflare.com", botChatPaired: true, botConflict: false },
      bot: { verified: true, id: "7000000001", username: "demo_helper_bot", displayName: "Demo Helper", linkedInZcode: false, enabledInZcode: false, polling: false },
    };
  }
}

export type AppClient = BridgeClient | DemoClient;
