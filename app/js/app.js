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
  detailId: null,
  detailOpen: false,
  searchSeq: 0,
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
  try {
    const res = await state.client.connect(getInitData());
    if (state.isDemo) {
      setStatus("demo");
      $("connStatus").textContent = "Демо-режим: показаны сгенерированные данные.";
    } else {
      haptic.notify("success");
      $("connStatus").textContent = `Подключено${res.user?.first_name ? " как " + res.user.first_name : ""}.`;
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
  if (state.statsLoaded) loadStats();
  if (state.detailOpen && state.detailId) loadDetail(state.detailId);
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

function renderOverviewError(msg) {
  $("ovStatus").dataset.state = "offline";
  $("ovStatus").innerHTML = `
    <div class="hero-top">
      <span class="pulse-dot" aria-hidden="true"></span>
      <span class="hero-state">нет связи</span>
    </div>
    <h2 class="hero-title">Мост недоступен</h2>
    <div class="hero-meta">${esc(msg || "")}</div>`;
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
  const detail = $("detail");
  detail.classList.remove("open");
  setTimeout(() => { if (!state.detailOpen) detail.hidden = true; }, 300);
  tg?.BackButton?.hide?.();
  haptic.tap();
}

/* ============================ Поиск ============================ */

function highlight(text, q) {
  const t = esc(text);
  const qq = esc(q).trim();
  if (!qq) return t;
  const idx = t.toLowerCase().indexOf(qq.toLowerCase());
  if (idx < 0) return t;
  return t.slice(0, idx) + "<mark>" + t.slice(idx, idx + qq.length) + "</mark>" + t.slice(idx + qq.length);
}

async function runSearch(q) {
  const seq = ++state.searchSeq;
  $("searchResults").innerHTML = skelRows(3);
  $("searchHint").textContent = `Ищем «${q}»…`;
  try {
    const data = await state.client.search(q, 20);
    if (seq !== state.searchSeq) return;
    const results = data.results || [];
    $("searchHint").textContent = results.length ? `Найдено: ${results.length}` : `Ищет по текстам всех сессий ZCODE.`;
    $("searchResults").innerHTML = results.length
      ? results.map((r, i) => `
        <button class="search-item" type="button" data-session="${esc(r.sessionId)}" style="--i:${Math.min(i, 12)}">
          <div class="search-head">
            <span class="search-title">${esc(r.sessionTitle)}</span>
            <span class="chip">${esc(fmtRel(r.time))}</span>
          </div>
          <div class="search-snippet">…${highlight(r.text, q)}…</div>
        </button>`).join("")
      : `<div class="empty">Ничего не найдено.</div>`;
    haptic.notify(results.length ? "success" : "warning");
  } catch (e) {
    if (seq !== state.searchSeq) return;
    $("searchResults").innerHTML = `<div class="empty">Ошибка: ${esc(e.message)}</div>`;
  }
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
    const btn = e.target.closest("[data-session]");
    if (btn) openSession(btn.dataset.session);
  });
  tg?.BackButton?.onClick?.(() => {
    if (state.detailOpen) closeDetail();
    else switchTab("overview");
  });
}

function bindSearch() {
  $("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("searchInput").value.trim();
    if (q.length < 2) {
      $("searchHint").textContent = "Введите хотя бы 2 символа.";
      return;
    }
    runSearch(q);
  });
  let deb;
  $("sessFilter").addEventListener("input", () => {
    clearTimeout(deb);
    deb = setTimeout(renderSessions, 150);
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
