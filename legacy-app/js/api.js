/* Клиент моста: HTTPS API + WebSocket-события.
   Авторизация — подписанный Telegram initData, который мост проверяет
   HMAC-подписью на сервере. Никаких секретов в клиенте нет и быть не должно. */

const REQUEST_TIMEOUT = 12_000;
const BACKOFF = [1_000, 2_000, 4_000, 8_000, 15_000];

async function postJson(url, body) {
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
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export class BridgeClient {
  /** handlers: { onStatus(state), onEvent(event) } */
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.baseUrl = "";
    this.initData = "";
    this.user = null;
    this.mode = "zcode";
    this.status = "offline";
    this.ws = null;
    this.disposed = false;
    this.wsFailures = 0;
    this.pollTimer = null;
    this.reconnectTimer = null;
  }

  _setStatus(state) {
    if (this.status === state) return;
    this.status = state;
    this.handlers.onStatus?.(state);
  }

  _emit(event) {
    this.handlers.onEvent?.(event);
  }

  setUrl(url) {
    this.baseUrl = (url || "").trim().replace(/\/+$/, "");
  }

  async connect(initData) {
    this.disposed = false;
    this.initData = initData;
    if (!this.baseUrl) throw new Error("Адрес моста не задан");
    if (this.baseUrl.startsWith("http:")) {
      throw new Error("Нужен HTTPS-адрес (страница открыта по https)");
    }
    this._setStatus("connecting");
    try {
      const res = await postJson(`${this.baseUrl}/api/auth`, { initData });
      if (!res.ok) throw new Error(res.error || "Авторизация не пройдена");
      this.user = res.user ?? null;
      this.mode = res.mode ?? "zcode";
      this.paired = !!res.paired;
      this.pairing = !!res.pairing;
      this.ownerMatch = res.ownerMatch;
      if (res.pairing) {
        // мост ещё не закреплён: открываем WS нельзя, ждём /api/pair
        this._setStatus("online");
        return { ok: true, user: this.user, mode: this.mode, pairing: true };
      }
      if (this.ownerMatch === false) {
        this._setStatus("offline");
        return { ok: true, user: this.user, mode: this.mode, ownerMismatch: true };
      }
    } catch (err) {
      this._setStatus("offline");
      throw err;
    }
    this._openWs();
    return { ok: true, user: this.user, mode: this.mode };
  }

  _openWs() {
    if (this.disposed) return;
    try {
      const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/ws";
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      const authTimer = setTimeout(() => ws.close(), 8_000);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "auth", initData: this.initData }));
      };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === "auth_ok") {
          clearTimeout(authTimer);
          this.wsFailures = 0;
          this._stopPolling();
          this._setStatus("online");
          this._emit({ type: "refresh", scope: "all" });
        } else if (msg.type === "auth_fail") {
          clearTimeout(authTimer);
          ws.close();
          this._setStatus("offline");
        } else if (msg.type === "refresh") {
          this._emit(msg);
        }
      };
      ws.onclose = () => {
        clearTimeout(authTimer);
        if (this.disposed) return;
        this.ws = null;
        this._scheduleReconnect();
      };
      ws.onerror = () => ws.close();
    } catch {
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this.disposed) return;
    const delay = BACKOFF[Math.min(this.wsFailures, BACKOFF.length - 1)];
    this.wsFailures += 1;
    // WS недоступен, но HTTP-авторизация прошла — переходим на поллинг
    if (this.wsFailures >= 2 && this.status !== "offline") this._startPolling();
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this._openWs(), delay);
  }

  _startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this._emit({ type: "refresh", scope: "all" });
    }, 12_000);
  }

  _stopPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  disconnect() {
    this.disposed = true;
    clearTimeout(this.reconnectTimer);
    this._stopPolling();
    try { this.ws?.close(); } catch { /* noop */ }
    this.ws = null;
    this._setStatus("offline");
  }

  reconnectNow() {
    if (this.disposed || !this.baseUrl) return;
    this.wsFailures = 0;
    this.connect(this.initData).catch(() => {});
  }

  async overview() {
    return postJson(`${this.baseUrl}/api/overview`, { initData: this.initData });
  }
  async sessions(limit = 40) {
    return postJson(`${this.baseUrl}/api/sessions`, { initData: this.initData, limit });
  }
  async sessionDetail(id) {
    return postJson(`${this.baseUrl}/api/session`, { initData: this.initData, id });
  }
  async search(q, limit = 20) {
    return postJson(`${this.baseUrl}/api/search`, { initData: this.initData, q, limit });
  }
  async stats(days = 7) {
    return postJson(`${this.baseUrl}/api/stats`, { initData: this.initData, days });
  }
  async bots() {
    return postJson(`${this.baseUrl}/api/bots`, { initData: this.initData });
  }
  async botUpdate(id, patch) {
    return postJson(`${this.baseUrl}/api/bot/update`, { initData: this.initData, id, patch });
  }
  async botDelete(id) {
    return postJson(`${this.baseUrl}/api/bot/delete`, { initData: this.initData, id });
  }
  async botLink(token) {
    return postJson(`${this.baseUrl}/api/bot/link`, { initData: this.initData, token });
  }
  async projects() {
    return postJson(`${this.baseUrl}/api/projects`, { initData: this.initData });
  }
  async pair() {
    return postJson(`${this.baseUrl}/api/pair`, { initData: this.initData });
  }
  async setup() {
    return postJson(`${this.baseUrl}/api/setup`, { initData: this.initData });
  }
}
