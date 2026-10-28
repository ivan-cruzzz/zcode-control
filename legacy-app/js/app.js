/* ZCODE Control — главный модуль: состояние, навигация, отрисовка. */

import {
  initTg, applyTheme, haptic, setHapticsEnabled,
  getInitData, getTgUser, tg, APP_VERSION,
} from "./tg.js";
import { BridgeClient } from "./api.js";
import { DemoClient } from "./demo.js";

const REPO_URL = "https://github.com/ivan-cruzzz/zcode-control";
const SETTINGS_KEY = "zcode.settings.v1";
const ACTIVE_WINDOW = 5 * 60_000;

const $ = (id) => document.getElementById(id);

const state = {
  client: null,
  isDemo: false,
  status: "connecting",
  sessions: [],
  overviewLoaded: false,
  sessionsLoaded: false,
  statsLoaded: false,
  botsLoaded: false,
  detailId: null,
  detailKind: null, // 'session' | 'bot' | 'newbot'
  detailOpen: false,
  searchSeq: 0,
  bots: [],
  projects: [],
};

const REPLY_MODES = [
  { id: "assistant_changes", title: "Стандартный", desc: "Текст ассистента и изменения файлов, без прогресса инструментов." },
  { id: "assistant_toolcalls_changes", title: "Подробный", desc: "То же плюс вызовы инструментов." },
  { id: "summary_changes", title: "Кратко", desc: "Только сводка изменений." },
  { id: "streaming_card", title: "Живая карточка", desc: "Ответ обновляется в реальном времени." },
];

const BOT_COMMAND_LABELS = {
  status: "/status", new: "/new", workspace: "Проект", model: "Модель",
  mode: "Режим", thoughtLevel: "Глубина", reply: "Ответ",
};

let settings = { apiUrl: "", theme: "auto", haptics: true };

/* ============================ Утилиты ============================ */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtTokens(n) {
  if (n == null) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + "k";
  return String(n);
}

function fmtRel(ms) {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "только что";
  if (diff < 3600_000) return Math.floor(diff / 60_000) + " мин назад";
  if (diff < 86_400_000) return Math.floor(diff / 3600_000) + " ч назад";
  if (diff < 2 * 86_400_000) return "вчера";
  const d = new Date(ms);
  return `${d.getDate()} ${["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"][d.getMonth()]}`;
}

function fmtDir(path) {
  if (!path) return "";
  const parts = String(path).replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function showToast(text, kind = "", ms = 2600) {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = text;
  $("toasts").appendChild(el);
  setTimeout(() => {
    el.classList.add("hide");
    setTimeout(() => el.remove(), 300);
  }, ms);
}

const skelHero = () => `<div class="skel hero"></div><div class="skel row"></div><div class="skel row"></div>`;
const skelRows = (n = 4) => Array.from({ length: n }, () => `<div class="skel row"></div>`).join("");

/* ============================ Настройки ============================ */

function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch { /* битый JSON — используем значения по умолчанию */ }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* noop */ }
}

/* ============================ Транспорт ============================ */

function setStatus(st) {
  state.status = st;
  const labels = { connecting: "подключение…", online: "на связи", offline: "нет связи", demo: "демо" };
  $("connPill").dataset.state = st;
  $("connLabel").textContent = labels[st] ?? st;
  $("offlineBanner").hidden = !(st === "offline" && !state.isDemo);
}

function createClient() {
  const handlers = {
    onStatus: setStatus,
    onEvent: (ev) => {
      if (ev.type !== "refresh") return;
      if (ev.scope === "all") refreshAll();
      else if (ev.scope === "overview") loadOverview();
      else if (ev.scope === "sessions") loadSessions();
      else if (ev.scope === "bots") { loadBots(); loadSetup(); }
      else if (ev.scope === "session" && ev.id && state.detailOpen && state.detailId === ev.id) loadDetail(ev.id);
    },
  };
  if ((settings.apiUrl || "").trim()) {
    state.isDemo = false;
    const c = new BridgeClient(handlers);
    c.setUrl(settings.apiUrl);
    return c;
  }
  state.isDemo = true;
  return new DemoClient(handlers);
}

async function connectClient() {
  $("ovDemoNote").hidden = !state.isDemo;
  $("connStatus").textContent = "Подключение…";
  $("pairRow").hidden = true;
  try {
    const res = await state.client.connect(getInitData());
    if (state.isDemo) {
      setStatus("demo");
      $("connStatus").textContent = "Демо-режим: показаны сгенерированные данные.";
    } else if (res.pairing) {
      setStatus("online");
      $("pairRow").hidden = false;
      $("connStatus").textContent = "Мост ещё не закреплён ни за кем. Нажмите кнопку ниже — и он будет отвечать только вам.";
      showToast("Мост требует привязки владельца", "", 3600);
      renderOverviewError("Закрепите мост за своим аккаунтом — кнопка в Настройках", "Требуется привязка");
    } else if (res.ownerMismatch) {
      setStatus("offline");
      $("connStatus").textContent = "Мост закреплён за другим аккаунтом. Доступ только для владельца.";
      renderOverviewError("Доступ только для владельца моста");
    } else {
      haptic.notify("success");
      $("connStatus").textContent = `Подключено${res.user?.first_name ? " как " + res.user.first_name : ""} · доступ: только владелец.`;
    }
    refreshAll();
  } catch (e) {
    setStatus("offline");
    $("connStatus").textContent = "Ошибка: " + e.message;
    if (!state.overviewLoaded) renderOverviewError(e.message);
  }
}

function refreshAll() {
  loadOverview();
  loadSessions();
  if (!state.isDemo) loadSetup();
  if (state.statsLoaded) loadStats();
  if (state.botsLoaded) loadBots();
  if (state.detailOpen && state.detailKind === "session" && state.detailId) loadDetail(state.detailId);
}

/* ============================ Обзор ============================ */

async function loadOverview() {
  try {
    const data = await state.client.overview();
    renderOverview(data);
    state.overviewLoaded = true;
  } catch { /* тихо: оставляем предыдущие данные/ошибку */ }
}

function outcomeChip(outcome) {
  if (outcome === "completed") return `<span class="chip accent">готово</span>`;
  if (outcome === "interrupted") return `<span class="chip warn">прервана</span>`;
  return "";
}

function renderOverview(data) {
  const st = data.status || {};
  const stats = data.stats || {};
  const sState = st.state === "active" ? "active" : st.state === "idle" ? "idle" : "offline";
  const stateLabel = { active: "ZCODE активен", idle: "ZCODE простаивает", offline: "нет данных" }[sState];

  $("ovStatus").dataset.state = sState;
  $("ovStatus").innerHTML = `
    <div class="hero-top">
      <span class="pulse-dot" aria-hidden="true"></span>
      <span class="hero-state">${stateLabel}</span>
      ${st.model ? `<span class="chip">${esc(st.model)}</span>` : ""}
      ${st.mode ? `<span class="chip info">${esc(st.mode)}</span>` : ""}
    </div>
    <h2 class="hero-title">${esc(st.session?.title || "Нет активных сессий")}</h2>
    <div class="hero-meta">${st.updatedAt ? "обновлён " + esc(fmtRel(st.updatedAt)) : ""}</div>`;

  $("ovStats").innerHTML = `
    <div class="stat-tile"><div class="stat-value accent">${fmtTokens(stats.tokensToday)}</div><div class="stat-label">токенов сегодня</div></div>
    <div class="stat-tile"><div class="stat-value">${stats.sessions ?? "—"}</div><div class="stat-label">сессий всего</div></div>
    <div class="stat-tile"><div class="stat-value">${stats.todosActive ?? 0}</div><div class="stat-label">задач в работе</div></div>
    <div class="stat-tile"><div class="stat-value">${stats.sessionsToday ?? 0}</div><div class="stat-label">сессий сегодня</div></div>`;

  const acts = data.activity || [];
  $("ovActivity").innerHTML = acts.length
    ? acts.map((a, i) => `
      <button class="activity-item" type="button" data-session="${esc(a.sessionId)}" style="--i:${i}">
        <div class="activity-text">${esc(a.text)}
          <div class="activity-meta">${esc(a.sessionTitle)} · ${esc(fmtRel(a.time))}</div>
        </div>
      </button>`).join("")
    : `<div class="empty">Пока тихо — активности не было.</div>`;
}

function renderOverviewError(msg, title = "Мост недоступен") {
  $("ovStatus").dataset.state = "offline";
  $("ovStatus").innerHTML = `
    <div class="hero-top">
      <span class="pulse-dot" aria-hidden="true"></span>
      <span class="hero-state">${esc(title)}</span>
    </div>
    <h2 class="hero-title">${esc(msg || "")}</h2>
    <div class="hero-meta">Подробнее — в Настройках</div>`;
  $("ovStats").innerHTML = "";
  $("ovActivity").innerHTML = `<div class="empty">Запустите мост на компьютере и укажите его адрес в Настройках.</div>`;
}

/* ============================ Сессии ============================ */

async function loadSessions() {
  try {
    const data = await state.client.sessions(40);
    state.sessions = data.sessions || [];
    state.sessionsLoaded = true;
    renderSessions();
  } catch { /* оставляем прошлое состояние */ }
}

function renderSessions() {
  const q = ($("sessFilter").value || "").trim().toLowerCase();
  const list = state.sessions.filter((s) =>
    !q || (s.title || "").toLowerCase().includes(q) || (s.directory || "").toLowerCase().includes(q));

  if (!state.sessions.length) {
    $("sessList").innerHTML = `<div class="empty">Сессий пока нет.</div>`;
    return;
  }
  if (!list.length) {
    $("sessList").innerHTML = `<div class="empty">Ничего не найдено по «${esc(q)}».</div>`;
    return;
  }

  $("sessList").innerHTML = list.map((s, i) => {
    const live = Date.now() - s.timeUpdated < ACTIVE_WINDOW;
    return `
    <button class="session-item" type="button" data-session="${esc(s.id)}" style="--i:${Math.min(i, 12)}">
      <div class="session-main">
        <div class="session-name">${esc(s.title || "(без названия)")}</div>
        <div class="session-sub">
          ${live ? `<span class="chip accent">live</span>` : outcomeChip(s.outcome)}
          <span class="dir">${esc(fmtDir(s.directory))}</span>
          <span>${fmtTokens(s.tokens)}</span>
          <span>${esc(fmtRel(s.timeUpdated))}</span>
        </div>
      </div>
      <svg class="session-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
    </button>`;
  }).join("");
}

/* ============================ Детали сессии ============================ */

async function openSession(id) {
  if (!id) return;
  haptic.impact("light");
  state.detailId = id;
  state.detailKind = "session";
  state.detailOpen = true;
  const detail = $("detail");
  detail.hidden = false;
  requestAnimationFrame(() => detail.classList.add("open"));
  $("detailTitle").textContent = "Загрузка…";
  $("detailBody").innerHTML = skelHero() + skelRows(3);
  tg?.BackButton?.show?.();
  await loadDetail(id);
}

async function loadDetail(id) {
  if (!state.detailOpen || state.detailId !== id) return;
  try {
    const data = await state.client.sessionDetail(id);
    if (!state.detailOpen || state.detailId !== id) return;
    renderDetail(data);
  } catch (e) {
    $("detailTitle").textContent = "Ошибка";
    $("detailBody").innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

function renderDetail({ session, todos, messages, tools }) {
  $("detailTitle").textContent = session.title || "(без названия)";
  const done = (todos || []).filter((t) => t.status === "completed").length;
  const msgs = messages || [];

  const todoIcon = (status) => status === "completed"
    ? `<svg class="todo-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>`
    : status === "in_progress"
      ? `<svg class="todo-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`
      : `<svg class="todo-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>`;

  $("detailBody").innerHTML = `
    <div class="kv-grid">
      <div class="kv"><b class="plus">${fmtTokens(session.tokens)}</b><span>токенов</span></div>
      <div class="kv"><b><span class="plus">+${session.additions ?? 0}</span> <span class="minus">−${session.deletions ?? 0}</span></b><span>строк</span></div>
      <div class="kv"><b>${done}/${(todos || []).length || 0}</b><span>задач</span></div>
    </div>
    <p class="hint-row" style="margin:0 0 14px">
      <span class="chip">${esc(fmtDir(session.directory))}</span>
      ${outcomeChip(session.outcome)}
      обновлена ${esc(fmtRel(session.timeUpdated))}
    </p>

    ${(todos || []).length ? `
      <h3 class="section-title">Задачи</h3>
      <div class="card">
        ${todos.map((t) => `
          <div class="todo-item ${t.status === "completed" ? "done" : ""} ${t.status === "in_progress" ? "active" : ""}">
            ${todoIcon(t.status)}
            <span>${esc(t.content)}</span>
            <span class="todo-priority">${esc(t.priority || "")}</span>
          </div>`).join("")}
      </div>` : ""}

    <h3 class="section-title">Диалог</h3>
    ${msgs.length ? msgs.map((m, i) => `
      <div class="msg ${m.role === "user" ? "user" : "assistant"}" style="--i:${Math.min(i, 10)}">
        ${esc((m.text || "").slice(0, 1500))}${(m.text || "").length > 1500 ? '<span class="more">…полный текст — в ZCODE</span>' : ""}
        <div class="msg-meta">${esc(fmtRel(m.time))}</div>
      </div>`).join("") : `<div class="empty">Сообщений нет.</div>`}

    ${(tools || []).length ? `
      <h3 class="section-title">Инструменты</h3>
      <div class="card">
        ${tools.map((t) => `
          <div class="tool-row">
            <span class="tool-name">${esc(t.name)}</span>
            <span class="tool-count">${t.count} вызовов · ~${t.avgMs ?? "—"} мс</span>
          </div>`).join("")}
      </div>` : ""}`;
}

function closeDetail() {
  if (!state.detailOpen) return;
  state.detailOpen = false;
  state.detailId = null;
  state.detailKind = null;
  const detail = $("detail");
  detail.classList.remove("open");
  setTimeout(() => { if (!state.detailOpen) detail.hidden = true; }, 300);
  tg?.BackButton?.hide?.();
  haptic.tap();
}

/* ============================ Поиск (внутри сессий) ============================ */

function highlight(text, q) {
  const t = esc(text);
  const qq = esc(q).trim();
  if (!qq) return t;
  const idx = t.toLowerCase().indexOf(qq.toLowerCase());
  if (idx < 0) return t;
  return t.slice(0, idx) + "<mark>" + t.slice(idx, idx + qq.length) + "</mark>" + t.slice(idx + qq.length);
}

async function runGlobalSearch(q) {
  const seq = ++state.searchSeq;
  $("globalTitle").hidden = false;
  $("globalTitle").textContent = `Сообщения · ищем «${q}»…`;
  $("globalList").innerHTML = skelRows(2);
  try {
    const data = await state.client.search(q, 12);
    if (seq !== state.searchSeq) return;
    const results = data.results || [];
    $("globalTitle").textContent = results.length ? `Сообщения · найдено: ${results.length}` : "Сообщения";
    $("globalList").innerHTML = results.length
      ? results.map((r, i) => `
        <button class="search-item" type="button" data-session="${esc(r.sessionId)}" style="--i:${Math.min(i, 12)}">
          <div class="search-head">
            <span class="search-title">${esc(r.sessionTitle)}</span>
            <span class="chip">${esc(fmtRel(r.time))}</span>
          </div>
          <div class="search-snippet">…${highlight(r.text, q)}…</div>
        </button>`).join("")
      : `<div class="empty">В сообщениях ничего не найдено.</div>`;
  } catch (e) {
    if (seq !== state.searchSeq) return;
    $("globalList").innerHTML = `<div class="empty">Ошибка поиска: ${esc(e.message)}</div>`;
  }
}

function clearGlobalSearch() {
  state.searchSeq += 1;
  $("globalTitle").hidden = true;
  $("globalList").innerHTML = "";
}

/* ============================ Подключение (мастер) ============================ */

async function loadSetup() {
  if (state.isDemo) { $("ovSetup").innerHTML = ""; return; }
  try {
    const data = await state.client.setup();
    renderSetup(data);
  } catch { /* мост ответит в следующий раз */ }
}

function setupRow(done, label, hint, action) {
  const icon = done
    ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent)" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>`
    : `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="color:var(--warn)" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>`;
  return `
    <div class="setup-row">
      <span class="setup-icon">${icon}</span>
      <span class="setup-text">
        <span class="setup-label">${esc(label)}</span>
        ${hint ? `<span class="setup-hint">${esc(hint)}</span>` : ""}
      </span>
      ${action || ""}
    </div>`;
}

function renderSetup(data) {
  const { bridge, ownerPaired, bot } = data;
  const allDone = ownerPaired && bridge.dbOk && bot.linkedInZcode && bot.polling && bot.enabledInZcode;

  if (allDone) {
    $("ovSetup").innerHTML = `
      <div class="setup-card all-done">
        <div class="setup-title">Всё подключено</div>
        <p class="hint-row" style="margin:6px 0 0">ZCODE управляется с телефона: команды — в чат <b>@${esc(bot.username)}</b>, панель наблюдения — здесь.</p>
      </div>`;
    return;
  }

  const rows = [
    setupRow(true, "Мост запущен", `режим: ${bridge.mode}`),
    setupRow(bridge.dbOk, bridge.dbOk ? "База ZCODE найдена" : "База ZCODE не найдена",
      bridge.dbOk ? "чтение включено" : "запустите мост рядом с ZCODE"),
    setupRow(ownerPaired, ownerPaired ? "Владелец закреплён" : "Владелец не закреплён",
      ownerPaired ? "доступ только у вас" : "мост открыт — зафиксируйте его за собой",
      ownerPaired ? "" : `<button class="btn btn-ghost setup-btn" type="button" data-setup-action="pair">Закрепить</button>`),
  ];

  if (bot.verified) {
    rows.push(setupRow(bot.linkedInZcode,
      bot.linkedInZcode ? `Бот @${bot.username} в ZCode` : `Бот @${bot.username} не привязан к ZCode`,
      bot.linkedInZcode ? (bot.enabledInZcode ? "привязан и включён" : "привязан, но выключен") : "одна вставка токена в панели Bots",
      bot.linkedInZcode ? "" : `<button class="btn btn-accent setup-btn" type="button" data-setup-action="guide">Привязать</button>`));
    rows.push(setupRow(bot.polling && bot.enabledInZcode, "Поллинг Telegram",
      bot.polling ? "живой канал активен" : bot.linkedInZcode && !bot.enabledInZcode ? "включите бота тумблером во вкладке Боты" : "включится после привязки"));
  } else {
    rows.push(setupRow(false, "Токен бота не настроен", "мост не смог проверить токен в .env"));
  }

  $("ovSetup").innerHTML = `
    <div class="setup-card">
      <div class="setup-title">Подключение ZCODE</div>
      ${rows.join("")}
    </div>`;
}

async function setupAction(action) {
  if (action === "pair") {
    try {
      await state.client.pair();
      haptic.notify("success");
      showToast("Мост закреплён за вашим аккаунтом", "ok");
      loadSetup();
    } catch (e) {
      showToast("Ошибка: " + e.message, "err");
    }
    return;
  }
  if (action === "guide") openSetupGuide();
}

function openSetupGuide() {
  const bot = state.client?.mode === "demo" ? { username: "demo_helper_bot" } : null;
  state.detailKind = "guide";
  state.detailOpen = true;
  state.detailId = null;
  const detail = $("detail");
  detail.hidden = false;
  requestAnimationFrame(() => detail.classList.add("open"));
  tg?.BackButton?.show?.();
  $("detailTitle").textContent = "Привязать бота к ZCODE";
  $("detailBody").innerHTML = `
    <div class="card">
      <h3 class="card-title">Зачем это нужно</h3>
      <p class="hint-row" style="margin:0">После привязки ZCode сам принимает сообщения этого бота: вы пишете команду в чат — ZCODE выполняет её на компьютере. Мини-апп при этом показывает сессии, задачи и управляет настройками бота.</p>
    </div>
    <div class="card">
      <h3 class="card-title">Шаги (один раз, на ПК)</h3>
      <div class="setup-step"><b>1.</b> Откройте ZCode на компьютере → панель <b>Bots</b> → <b>New bot</b>.</div>
      <div class="setup-step"><b>2.</b> Получите токен: в Telegram у <b>@BotFather</b> → <code>/mybots</code> → выберите бота → <b>API Token</b>.</div>
      <div class="setup-step"><b>3.</b> Вставьте токен в ZCode и включите переключатель — появится «Telegram long polling is running».</div>
      <div class="setup-step"><b>4.</b> Вернитесь сюда и нажмите «Проверить снова» — галочка «Бот в ZCode» станет зелёной.</div>
    </div>
    <div class="card">
      <h3 class="card-title">Затем</h3>
      <p class="hint-row" style="margin:0">Командуйте боту в Telegram (например: «сделай …»), а состояние смотрите во вкладках Обзор и Сессии. Настройки бота — во вкладке Боты.</p>
    </div>
    <div class="btn-row">
      <button id="btnSetupRecheck" class="btn btn-accent" type="button">Проверить снова</button>
    </div>
    ${bot ? `<p class="hint-row" style="margin-top:8px">Демо: покажется тестовый бот ${esc("@" + bot.username)}.</p>` : ""}`;

  $("btnSetupRecheck").addEventListener("click", async () => {
    const btn = $("btnSetupRecheck");
    btn.disabled = true;
    btn.textContent = "Проверяю…";
    await loadSetup();
    btn.disabled = false;
    btn.textContent = "Проверить снова";
    const done = state.client && $("ovSetup").textContent.includes("Всё подключено");
    haptic.notify(done ? "success" : "warning");
    if (done) closeDetail();
  });
}

/* ============================ Боты ============================ */

async function loadBots() {
  try {
    const data = await state.client.bots();
    state.bots = data.bots || [];
    state.botsLoaded = true;
    renderBots(data.polling);
  } catch { /* тихо */ }
}

async function ensureProjects() {
  if (state.projects.length) return state.projects;
  try {
    const data = await state.client.projects();
    state.projects = data.projects || [];
  } catch { state.projects = []; }
  return state.projects;
}

function renderBots(polling) {
  if (polling !== undefined) state.lastPolling = polling;
  const poll = state.lastPolling ?? false;
  $("botsStatus").textContent = state.bots.length
    ? `Поллинг Telegram: ${poll ? "активен" : "остановлен"} · ботов: ${state.bots.length}`
    : "";
  if (!state.bots.length) {
    $("botsList").innerHTML = `<div class="empty">Ботов нет. Создайте бота у @BotFather и нажмите «Новый бот».</div>`;
    return;
  }
  $("botsList").innerHTML = state.bots.map((b, i) => `
    <div class="bot-item" style="--i:${Math.min(i, 12)}">
      <button class="bot-link" type="button" data-bot="${esc(b.id)}">
        <span class="bot-avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4 3 11l6 2 2 6 4-5 5 1z"/></svg>
        </span>
        <span class="bot-main">
          <span class="bot-name">${esc(b.displayName)}
            ${b.running ? '<span class="chip accent">работает</span>' : b.enabled ? '<span class="chip warn">ожидает</span>' : '<span class="chip">выключен</span>'}
          </span>
          <span class="bot-sub">${esc(b.provider)}${b.workspacePath ? " · " + esc(fmtDir(b.workspacePath)) : ""}</span>
        </span>
      </button>
      <button class="mini-switch ${b.enabled ? "on" : ""}" type="button" role="switch" aria-checked="${b.enabled}"
              aria-label="Включён ли бот" data-bot-toggle="${esc(b.id)}"></button>
    </div>`).join("");
}

async function toggleBot(id, el) {
  const bot = state.bots.find((b) => b.id === id);
  if (!bot) return;
  const next = !bot.enabled;
  haptic.impact("light");
  el.classList.toggle("on", next);
  try {
    await state.client.botUpdate(id, { enabled: next });
    bot.enabled = next;
    bot.running = next && bot.running;
    showToast(next ? "Бот включён" : "Бот выключен", "ok");
    renderBots();
    if (state.detailOpen && state.detailKind === "bot" && state.detailId === id) renderBotDetail(bot);
  } catch (e) {
    el.classList.toggle("on", !next);
    showToast("Ошибка: " + e.message, "err");
  }
}

async function openBot(id) {
  const bot = state.bots.find((b) => b.id === id);
  if (!bot) return;
  haptic.impact("light");
  state.detailId = id;
  state.detailKind = "bot";
  state.detailOpen = true;
  const detail = $("detail");
  detail.hidden = false;
  requestAnimationFrame(() => detail.classList.add("open"));
  tg?.BackButton?.show?.();
  await ensureProjects();
  if (state.detailKind === "bot") renderBotDetail(bot);
}

function renderBotDetail(bot) {
  $("detailTitle").textContent = bot.displayName;
  const wsAll = (bot.allowedWorkspaces || []).includes("*");

  const cmdChips = Object.entries(BOT_COMMAND_LABELS).map(([key, label]) => {
    const on = bot.allowedCommands?.[key] !== false;
    return `<button class="chip toggle ${on ? "on" : ""}" type="button" data-cmd="${key}" role="switch" aria-checked="${on}">${esc(label)}</button>`;
  }).join("");

  const projectChips = state.projects.map((p) => {
    const on = !wsAll && bot.allowedWorkspaces.includes(p.id);
    return `<button class="chip toggle ${on ? "on" : ""}" type="button" data-proj="${esc(p.id)}" role="switch" aria-checked="${on}">${esc(fmtDir(p.directory))}</button>`;
  }).join("");

  $("detailBody").innerHTML = `
    <p class="hint-row" style="margin:0 0 14px">
      <span class="chip ${bot.running ? "accent" : bot.enabled ? "warn" : ""}">${bot.running ? "поллинг активен" : bot.enabled ? "ожидает запуска" : "выключен"}</span>
      <span class="chip">${esc(bot.provider)}</span>
      ${bot.workspacePath ? `<span class="chip info">${esc(fmtDir(bot.workspacePath))}</span>` : ""}
    </p>

    <h3 class="section-title">Гранулярность ответов</h3>
    <div class="card">
      ${REPLY_MODES.map((m) => `
        <button class="radio-row ${bot.replyMode === m.id ? "on" : ""}" type="button" data-reply="${m.id}" role="radio" aria-checked="${bot.replyMode === m.id}">
          <span class="radio-dot" aria-hidden="true"></span>
          <span><span class="radio-title">${m.title}</span><div class="radio-desc">${m.desc}</div></span>
        </button>`).join("")}
    </div>

    <h3 class="section-title">Доступ к проектам</h3>
    <div class="card">
      <div class="chips-wrap">
        <button class="chip toggle ${wsAll ? "on" : ""}" type="button" id="projAll">Все проекты</button>
        ${projectChips}
      </div>
      <p class="hint-row">Выберите конкретные проекты, если доступ нужно ограничить.</p>
    </div>

    <h3 class="section-title">Команды в чате</h3>
    <div class="card">
      <div class="chips-wrap">${cmdChips}</div>
    </div>

    <h3 class="section-title">Имя</h3>
    <div class="card">
      <input id="botNameInput" class="input" type="text" maxlength="64" value="${esc(bot.name || "")}" placeholder="${esc(bot.displayName)}">
      <div class="btn-row"><button id="btnSaveName" class="btn btn-ghost" type="button">Сохранить имя</button></div>
    </div>

    <div class="danger-zone">
      <button id="btnDeleteBot" class="btn btn-danger btn-block" type="button">Удалить бота</button>
    </div>`;

  bindBotDetail(bot);
}

function bindBotDetail(bot) {
  const save = (patch, okText) => state.client.botUpdate(bot.id, patch)
    .then(() => {
      Object.assign(bot, patch);
      if (patch.allowedWorkspaces !== undefined) bot.allowedWorkspaces = patch.allowedWorkspaces === "*" ? ["*"] : patch.allowedWorkspaces;
      if (patch.allowedCommands !== undefined) bot.allowedCommands = { ...bot.allowedCommands, ...patch.allowedCommands };
      haptic.notify("success");
      if (okText) showToast(okText, "ok");
      renderBots();
    })
    .catch((e) => { haptic.notify("error"); showToast("Ошибка: " + e.message, "err"); });

  $("detailBody").querySelectorAll("[data-reply]").forEach((row) =>
    row.addEventListener("click", () => {
      haptic.tap();
      $("detailBody").querySelectorAll("[data-reply]").forEach((r) => {
        r.classList.toggle("on", r === row);
        r.setAttribute("aria-checked", r === row ? "true" : "false");
      });
      save({ replyMode: row.dataset.reply }, "Режим ответов обновлён");
    }));

  $("projAll").addEventListener("click", () => {
    haptic.tap();
    save({ allowedWorkspaces: ["*"] }, "Доступ: все проекты").then(() => renderBotDetail(bot));
  });
  $("detailBody").querySelectorAll("[data-proj]").forEach((chip) =>
    chip.addEventListener("click", () => {
      haptic.tap();
      const id = chip.dataset.proj;
      let list = (bot.allowedWorkspaces || []).includes("*") ? [] : [...bot.allowedWorkspaces];
      list = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      if (!list.length) { showToast("Нужен хотя бы один проект — вернул «Все проекты»", ""); return; }
      save({ allowedWorkspaces: list }).then(() => renderBotDetail(bot));
    }));

  $("detailBody").querySelectorAll("[data-cmd]").forEach((chip) =>
    chip.addEventListener("click", () => {
      haptic.tap();
      const key = chip.dataset.cmd;
      const next = { ...(bot.allowedCommands || {}) };
      next[key] = next[key] === false ? true : false;
      save({ allowedCommands: next }).then(() => renderBotDetail(bot));
    }));

  $("btnSaveName").addEventListener("click", () => {
    const name = $("botNameInput").value.trim();
    save({ name }, name ? "Имя сохранено" : "Имя очищено").then(() => renderBotDetail(bot));
  });

  const del = $("btnDeleteBot");
  del.addEventListener("click", async () => {
    if (!del.classList.contains("arm")) {
      del.classList.add("arm");
      del.textContent = "Точно удалить? Нажмите ещё раз";
      setTimeout(() => {
        del.classList.remove("arm");
        del.textContent = "Удалить бота";
      }, 3_500);
      return;
    }
    try {
      await state.client.botDelete(bot.id);
      haptic.notify("warning");
      showToast("Бот удалён", "ok");
      state.bots = state.bots.filter((b) => b.id !== bot.id);
      renderBots();
      closeDetail();
    } catch (e) {
      showToast("Ошибка: " + e.message, "err");
    }
  });
}

function openNewBot() {
  haptic.impact("light");
  state.detailKind = "newbot";
  state.detailOpen = true;
  state.detailId = null;
  const detail = $("detail");
  detail.hidden = false;
  requestAnimationFrame(() => detail.classList.add("open"));
  tg?.BackButton?.show?.();

  $("detailTitle").textContent = "Новый бот";
  $("detailBody").innerHTML = `
    <div class="card">
      <h3 class="card-title">Шаг 1 · Проверка токена</h3>
      <label class="field-label" for="newBotToken">Токен от @BotFather</label>
      <input id="newBotToken" class="input mono" type="password" autocomplete="off" spellcheck="false" placeholder="123456789:AA…">
      <div class="btn-row"><button id="btnCheckToken" class="btn btn-accent" type="button">Проверить</button></div>
      <p class="hint-row">Токен проверяется мостом через Telegram и нигде не сохраняется: ZCode шифрует токены своим ключом.</p>
    </div>
    <div id="newBotResult"></div>`;

  $("btnCheckToken").addEventListener("click", async () => {
    const token = $("newBotToken").value.trim();
    if (!token) return;
    const btn = $("btnCheckToken");
    btn.disabled = true;
    btn.textContent = "Проверяю…";
    try {
      const res = await state.client.botLink(token);
      $("newBotResult").innerHTML = `
        <div class="card">
          <h3 class="card-title">${res.alreadyLinked ? "Бот уже привязан" : "✓ " + esc(res.displayName)}</h3>
          <p class="hint-row">@${esc(res.username)} · ${esc(res.hint)}</p>
        </div>`;
      haptic.notify("success");
    } catch (e) {
      $("newBotResult").innerHTML = `<div class="empty">Ошибка: ${esc(e.message)}</div>`;
      haptic.notify("error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Проверить";
    }
  });
}

/* ============================ Статистика ============================ */

async function loadStats() {
  try {
    const data = await state.client.stats(7);
    renderStats(data);
    state.statsLoaded = true;
  } catch { /* noop */ }
}

function rankRows(items, valueFn, labelFn, fmtVal) {
  const max = Math.max(...items.map(valueFn), 1);
  return items.map((it) => `
    <div class="rank-row">
      <span class="rank-name">${esc(labelFn(it))}</span>
      <div class="rank-bar"><i style="width:${Math.max(2, Math.round(valueFn(it) / max * 100))}%"></i></div>
      <span class="rank-val">${fmtVal(it)}</span>
    </div>`).join("");
}

function renderStats({ daily, models, tools }) {
  const days = daily || [];
  const maxTokens = Math.max(...days.map((d) => d.tokens || 0), 1);
  $("statsChart").innerHTML = days.length ? days.map((d, i) => `
    <div class="chart-col" title="${esc(d.date)}: ${fmtTokens(d.tokens)} токенов, ${d.sessions ?? 0} сессий"
         aria-label="${esc(d.date)}: ${fmtTokens(d.tokens)} токенов">
      <span class="chart-value">${fmtTokens(d.tokens)}</span>
      <div class="chart-bar" style="height:${Math.max(2, Math.round((d.tokens || 0) / maxTokens * 100))}%; --i:${i}"></div>
      <span class="chart-label">${esc(d.date.slice(8))}</span>
    </div>`).join("") : `<div class="empty">Нет данных.</div>`;

  $("statsModels").innerHTML = (models || []).length
    ? rankRows(models, (m) => m.tokens, (m) => m.model, (m) => fmtTokens(m.tokens))
    : `<div class="empty">Нет данных.</div>`;

  $("statsTools").innerHTML = (tools || []).length
    ? rankRows(tools, (t) => t.count, (t) => t.name, (t) => String(t.count))
    : `<div class="empty">Нет данных.</div>`;
}

/* ============================ Навигация и биндинги ============================ */

function switchTab(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  document.querySelectorAll(".tabbar .tab").forEach((t) => {
    const active = t.dataset.view === name;
    t.classList.toggle("active", active);
    if (active) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });
  haptic.tap();
  if (name === "sessions" && !state.sessionsLoaded) loadSessions();
  if (name === "stats" && !state.statsLoaded) loadStats();
  if (name === "bots" && !state.botsLoaded) loadBots();
  window.scrollTo({ top: 0 });
}

function renderUserCard() {
  const u = getTgUser();
  $("userCard").innerHTML = u
    ? `<div class="user-avatar">${esc((u.first_name || "?")[0].toUpperCase())}</div>
       <div><div class="user-name">${esc([u.first_name, u.last_name].filter(Boolean).join(" "))}</div>
       <div class="user-sub">id: ${esc(u.id)}${u.username ? " · @" + esc(u.username) : ""}</div></div>`
    : `<div class="user-avatar">?</div>
       <div><div class="user-name">Гость</div>
       <div class="user-sub">открыто в браузере, не в Telegram</div></div>`;
}

function bindNav() {
  document.querySelectorAll(".tabbar .tab").forEach((t) =>
    t.addEventListener("click", () => switchTab(t.dataset.view)));
  document.querySelectorAll("[data-goto]").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); switchTab(a.dataset.goto); }));
  document.addEventListener("click", (e) => {
    const setupBtn = e.target.closest("[data-setup-action]");
    if (setupBtn) { setupAction(setupBtn.dataset.setupAction); return; }
    const toggle = e.target.closest("[data-bot-toggle]");
    if (toggle) { e.stopPropagation(); toggleBot(toggle.dataset.botToggle, toggle); return; }
    const botBtn = e.target.closest("[data-bot]");
    if (botBtn) { openBot(botBtn.dataset.bot); return; }
    const btn = e.target.closest("[data-session]");
    if (btn) openSession(btn.dataset.session);
  });
  $("btnNewBot").addEventListener("click", openNewBot);
  tg?.BackButton?.onClick?.(() => {
    if (state.detailOpen) closeDetail();
    else switchTab("overview");
  });
}

function bindSearch() {
  let debLocal, debGlobal;
  $("sessFilter").addEventListener("input", () => {
    clearTimeout(debLocal);
    debLocal = setTimeout(renderSessions, 150);

    const q = $("sessFilter").value.trim();
    clearTimeout(debGlobal);
    if (q.length >= 3) debGlobal = setTimeout(() => runGlobalSearch(q), 500);
    else clearGlobalSearch();
  });
}

function bindSettings() {
  $("btnConnect").addEventListener("click", async () => {
    const url = $("apiUrl").value.trim();
    if (!url) {
      $("connStatus").textContent = "Введите адрес моста или очистите поле для демо-режима.";
      return;
    }
    settings.apiUrl = url;
    saveSettings();
    state.client?.disconnect?.();
    state.overviewLoaded = false;
    state.sessionsLoaded = false;
    state.statsLoaded = false;
    state.client = createClient();
    await connectClient();
  });

  $("btnDisconnect").addEventListener("click", () => {
    state.client?.disconnect?.();
    settings.apiUrl = "";
    saveSettings();
    $("apiUrl").value = "";
    $("connStatus").textContent = "Отключено. Поле адреса очищено — вернёмся в демо-режим.";
    state.client = createClient();
    connectClient();
  });

  $("themeSelect").addEventListener("change", (e) => {
    settings.theme = e.target.value;
    saveSettings();
    applyTheme(settings.theme);
    haptic.tap();
  });

  $("hapticsToggle").addEventListener("change", (e) => {
    settings.haptics = e.target.checked;
    setHapticsEnabled(settings.haptics);
    saveSettings();
    haptic.notify("success");
  });

  $("connPill").addEventListener("click", () => {
    if (state.status === "offline" && !state.isDemo) {
      if (typeof state.client?.reconnectNow === "function") state.client.reconnectNow();
      else showToast("Переподключение…");
    }
  });

  $("btnBack").addEventListener("click", closeDetail);

  $("btnPair").addEventListener("click", async () => {
    const btn = $("btnPair");
    btn.disabled = true;
    btn.textContent = "Закрепляю…";
    try {
      const res = await state.client.pair();
      haptic.notify("success");
      showToast("Мост закреплён за вашим аккаунтом", "ok", 3200);
      $("pairRow").hidden = true;
      state.overviewLoaded = false;
      state.sessionsLoaded = false;
      state.botsLoaded = false;
      await connectClient();
    } catch (e) {
      haptic.notify("error");
      showToast("Ошибка: " + e.message, "err", 3600);
      $("connStatus").textContent = e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = "Закрепить этот аккаунт за мостом";
    }
  });
}

/* ============================ Запуск ============================ */

function boot() {
  initTg();
  loadSettings();
  applyTheme(settings.theme);
  setHapticsEnabled(settings.haptics);

  $("aboutVersion").textContent = "v" + APP_VERSION;
  $("linkRepo").href = REPO_URL;
  $("apiUrl").value = settings.apiUrl;
  $("themeSelect").value = settings.theme;
  $("hapticsToggle").checked = settings.haptics;

  renderUserCard();
  bindNav();
  bindSearch();
  bindSettings();

  tg?.onEvent?.("themeChanged", () => applyTheme(settings.theme));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (state.status === "offline" && !state.isDemo && state.client) {
      if (typeof state.client.reconnectNow === "function") state.client.reconnectNow();
      else connectClient();
    }
  });

  // стартовый скелетон, чтобы не мигало
  $("ovStatus").innerHTML = skelHero();
  $("ovActivity").innerHTML = skelRows(3);
  $("sessList").innerHTML = skelRows(4);

  state.client = createClient();
  connectClient();
}

boot();
