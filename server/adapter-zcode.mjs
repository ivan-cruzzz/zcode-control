/* Адаптер ZCODE: читает локальную базу ZCODE в режиме read-only
   и отдаёт данные в форматах, которые ждёт мини-апп.
   Раз в 3 секунды следит за изменениями и публикует события refresh. */

import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { DatabaseSync } from "node:sqlite";

export class ZcodeAdapter {
  constructor(opts = {}) {
    this.mode = "zcode";
    this.dbPath = opts.dbPath || process.env.ZCODE_DB ||
      path.join(os.homedir(), ".zcode", "cli", "db", "db.sqlite");
    this.events = new EventEmitter();
    this.db = null;
    this.pollTimer = null;
    this._tokensCache = null;
    this._tokensCacheAt = 0;
    this._prev = { sessionUpdated: 0, msgMax: 0, msgCount: 0, todoUpdated: 0 };
  }

  start() {
    this.db = new DatabaseSync(this.dbPath, { readOnly: true });
    this._poll();
    this.pollTimer = setInterval(() => this._poll(), 3_000);
  }

  stop() {
    clearInterval(this.pollTimer);
    try { this.db?.close(); } catch { /* noop */ }
  }

  /* ---------- служебные ---------- */

  q(sql, ...params) {
    try {
      return this.db.prepare(sql).all(...params);
    } catch {
      return [];
    }
  }

  _poll() {
    try {
      const s = this.q("SELECT COALESCE(MAX(time_updated),0) AS v FROM session WHERE time_deleted IS NULL")[0]?.v ?? 0;
      const m = this.q("SELECT COALESCE(MAX(time_created),0) AS v, COUNT(*) AS c FROM message")[0] ?? {};
      const t = this.q("SELECT COALESCE(MAX(time_updated),0) AS v FROM todo")[0]?.v ?? 0;
      const lastMsgSession = this.q("SELECT session_id FROM message ORDER BY time_created DESC LIMIT 1")[0]?.session_id ?? null;
      const todoSession = this.q("SELECT session_id FROM todo ORDER BY time_updated DESC LIMIT 1")[0]?.session_id ?? null;

      const p = this._prev;
      if (s !== p.sessionUpdated) {
        p.sessionUpdated = s;
        this.events.emit("refresh", { scope: "overview" });
        this.events.emit("refresh", { scope: "sessions" });
      }
      if (m.v !== p.msgMax || m.c !== p.msgCount) {
        p.msgMax = m.v;
        p.msgCount = m.c;
        this.events.emit("refresh", { scope: "overview" });
        if (lastMsgSession) this.events.emit("refresh", { scope: "session", id: lastMsgSession });
      }
      if (t !== p.todoUpdated) {
        p.todoUpdated = t;
        this.events.emit("refresh", { scope: "overview" });
        if (todoSession) this.events.emit("refresh", { scope: "session", id: todoSession });
      }
    } catch { /* база могла быть занята — попробуем в следующий тик */ }
  }

  dayStartMs() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  tokensBySession() {
    const now = Date.now();
    if (this._tokensCache && now - this._tokensCacheAt < 30_000) return this._tokensCache;
    const map = new Map();
    for (const row of this.q(
      "SELECT session_id, SUM(computed_total_tokens) AS t FROM model_usage GROUP BY session_id"
    )) {
      map.set(row.session_id, row.t || 0);
    }
    this._tokensCache = map;
    this._tokensCacheAt = now;
    return map;
  }

  static visible(data) {
    const sem = data?.semantics;
    return !(sem && (sem.uiVisibility === "hidden" || sem.transcriptVisibility === "hidden"));
  }

  messageText(messageId, cap = 2000) {
    const parts = this.q(
      "SELECT data FROM part WHERE message_id = ? ORDER BY sequence", messageId
    );
    const texts = [];
    for (const p of parts) {
      if (!p.data || !p.data.includes('"type":"text"')) continue;
      try {
        const d = JSON.parse(p.data);
        if (d.type === "text" && typeof d.text === "string") texts.push(d.text);
      } catch { /* битая часть — пропускаем */ }
      if (texts.join("\n").length > cap) break;
    }
    return texts.join("\n").slice(0, cap);
  }

  /* ---------- API для моста ---------- */

  async overview() {
    const dayStart = this.dayStartMs();
    const s = this.q(
      "SELECT id, title, directory, time_updated FROM session WHERE time_deleted IS NULL ORDER BY time_updated DESC LIMIT 1"
    )[0];
    const lastModel = this.q(
      "SELECT model_id, mode FROM model_usage ORDER BY started_at DESC LIMIT 1"
    )[0];
    const tokensToday = this.q(
      "SELECT COALESCE(SUM(computed_total_tokens),0) AS t FROM model_usage WHERE started_at >= ?", dayStart
    )[0]?.t ?? 0;
    const sessionsTotal = this.q(
      "SELECT COUNT(*) AS c FROM session WHERE time_deleted IS NULL"
    )[0]?.c ?? 0;
    const sessionsToday = this.q(
      "SELECT COUNT(*) AS c FROM session WHERE time_deleted IS NULL AND time_created >= ?", dayStart
    )[0]?.c ?? 0;
    const todosActive = this.q(
      "SELECT COUNT(*) AS c FROM todo WHERE status = 'in_progress'"
    )[0]?.c ?? 0;

    const activity = [];
    const rows = this.q(
      `SELECT p.time_created, m.session_id, s.title, p.data
       FROM part p
       JOIN message m ON m.id = p.message_id
       JOIN session s ON s.id = m.session_id
       WHERE p.data LIKE '%"type":"text"%'
       ORDER BY p.time_created DESC LIMIT 40`
    );
    for (const r of rows) {
      try {
        const d = JSON.parse(r.data);
        if (d.type !== "text" || typeof d.text !== "string" || !d.text.trim()) continue;
        activity.push({
          sessionId: r.session_id,
          sessionTitle: r.title || "(без названия)",
          time: r.time_created,
          text: d.text.slice(0, 240),
        });
        if (activity.length >= 6) break;
      } catch { /* пропускаем */ }
    }

    return {
      status: {
        state: s && Date.now() - s.time_updated < 5 * 60_000 ? "active" : s ? "idle" : "offline",
        model: lastModel?.model_id ?? null,
        mode: lastModel?.mode ?? null,
        updatedAt: s?.time_updated ?? null,
        session: s ? { id: s.id, title: s.title } : null,
      },
      stats: {
        sessions: sessionsTotal,
        sessionsToday,
        tokensToday,
        todosActive,
      },
      activity,
    };
  }

  async sessions({ limit = 40 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 40, 1), 100);
    const rows = this.q(
      `SELECT id, title, directory, time_created, time_updated, last_outcome,
              summary_additions, summary_deletions
       FROM session WHERE time_deleted IS NULL
       ORDER BY time_updated DESC LIMIT ?`, lim
    );
    const tokens = this.tokensBySession();
    return {
      sessions: rows.map((r) => ({
        id: r.id,
        title: r.title,
        directory: r.directory,
        timeUpdated: r.time_updated,
        outcome: r.last_outcome ?? null,
        tokens: tokens.get(r.id) ?? 0,
      })),
    };
  }

  async sessionDetail({ id }) {
    const s = this.q(
      `SELECT id, title, directory, time_created, time_updated, last_outcome,
              summary_additions, summary_deletions
       FROM session WHERE id = ? AND time_deleted IS NULL`, id
    )[0];
    if (!s) throw new Error("Сессия не найдена");

    const todos = this.q(
      "SELECT content, status, priority FROM todo WHERE session_id = ? ORDER BY position", id
    );
    const tokens = this.tokensBySession().get(id) ?? 0;

    const rawMsgs = this.q(
      "SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created DESC LIMIT 30", id
    ).reverse();

    const messages = [];
    for (const m of rawMsgs) {
      let meta = {};
      try { meta = JSON.parse(m.data || "{}"); } catch { /* пусто */ }
      if (!ZcodeAdapter.visible(meta)) continue;
      const text = this.messageText(m.id);
      if (!text.trim()) continue;
      messages.push({
        id: m.id,
        role: meta.role === "user" ? "user" : "assistant",
        time: m.time_created,
        text,
        more: text.length >= 2000,
      });
    }

    const tools = this.q(
      `SELECT tool_name AS name, COUNT(*) AS count, CAST(AVG(duration_ms) AS INTEGER) AS avgMs
       FROM tool_usage WHERE session_id = ?
       GROUP BY tool_name ORDER BY count DESC LIMIT 8`, id
    );

    return {
      session: {
        id: s.id,
        title: s.title,
        directory: s.directory,
        timeCreated: s.time_created,
        timeUpdated: s.time_updated,
        outcome: s.last_outcome ?? null,
        additions: s.summary_additions ?? 0,
        deletions: s.summary_deletions ?? 0,
        tokens,
      },
      todos,
      messages,
      tools,
    };
  }

  async search({ q, limit = 20 } = {}) {
    const needle = String(q).toLowerCase().slice(0, 100);
    const escaped = needle.replace(/[\\%_]/g, (c) => "\\" + c);
    const rows = this.q(
      `SELECT p.time_created, p.data, m.session_id, s.title
       FROM part p
       JOIN message m ON m.id = p.message_id
       JOIN session s ON s.id = m.session_id
       WHERE p.data LIKE ? ESCAPE '\\'
       ORDER BY p.time_created DESC LIMIT 300`,
      `%${escaped}%`
    );
    const results = [];
    for (const r of rows) {
      try {
        const d = JSON.parse(r.data);
        if (d.type !== "text" || typeof d.text !== "string") continue;
        const idx = d.text.toLowerCase().indexOf(needle);
        if (idx < 0) continue;
        const start = Math.max(0, idx - 60);
        results.push({
          sessionId: r.session_id,
          sessionTitle: r.title || "(без названия)",
          time: r.time_created,
          text: d.text.slice(start, idx + needle.length + 120),
        });
        if (results.length >= (Number(limit) || 20)) break;
      } catch { /* пропускаем */ }
    }
    return { results };
  }

  async stats({ days = 7 } = {}) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const since = d.getTime() - (Math.max(days, 1) - 1) * 86_400_000;

    const dailyTokens = this.q(
      `SELECT strftime('%Y-%m-%d', started_at/1000, 'unixepoch') AS date,
              COALESCE(SUM(computed_total_tokens),0) AS tokens, COUNT(*) AS runs
       FROM model_usage WHERE started_at >= ? GROUP BY date ORDER BY date`, since
    );
    const dailySessions = this.q(
      `SELECT strftime('%Y-%m-%d', time_created/1000, 'unixepoch') AS date, COUNT(*) AS sessions
       FROM session WHERE time_created >= ? AND time_deleted IS NULL GROUP BY date ORDER BY date`, since
    );
    const sessMap = new Map(dailySessions.map((r) => [r.date, r.sessions]));

    // заполняем пропущенные дни нулями
    const daily = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(since + i * 86_400_000).toISOString().slice(0, 10);
      const t = dailyTokens.find((r) => r.date === date);
      daily.push({ date, tokens: t?.tokens ?? 0, sessions: sessMap.get(date) ?? 0 });
    }

    const models = this.q(
      `SELECT model_id AS model, COALESCE(SUM(computed_total_tokens),0) AS tokens, COUNT(*) AS runs
       FROM model_usage WHERE started_at >= ? GROUP BY model_id ORDER BY tokens DESC LIMIT 5`, since
    );
    const tools = this.q(
      `SELECT tool_name AS name, COUNT(*) AS count
       FROM tool_usage WHERE started_at >= ? GROUP BY tool_name ORDER BY count DESC LIMIT 6`, since
    );

    return { daily, models, tools };
  }
}
