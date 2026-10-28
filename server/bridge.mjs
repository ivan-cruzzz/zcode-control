/* Локальный мост ZCODE ↔ Telegram Mini App.
   Читает базу ZCODE (только чтение) и отдаёт её мини-аппу по HTTPS/WSS
   после проверки подписи Telegram initData. Токен бота живёт только здесь,
   на вашем компьютере, и никогда не попадает в репозиторий или клиент. */

import http from "node:http";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { Tunnel, BotLink } from "./tunnel.mjs";
import { ZcodeBot, FREE_TUNNEL_MIN } from "./tg-bot.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------- конфигурация ---------- */

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const val = m[2].replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}

function toInt(v, def) {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : def;
}

function parseIds(v) {
  return (v || "")
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter(Number.isFinite);
}

loadEnv(path.join(__dirname, ".env"));

const CONFIG = {
  port: toInt(process.env.PORT, 8787),
  botToken: process.env.BOT_TOKEN || "",
  allowedUsers: parseIds(process.env.ALLOWED_USER_IDS), // пусто = любой валидно подписанный initData
  maxAuthAge: toInt(process.env.MAX_AUTH_AGE, 86_400),
  allowedOrigins: (
    process.env.ALLOWED_ORIGINS ||
    [
      "https://ivan-cruzzz.github.io",
      "http://localhost:3000", "http://127.0.0.1:3000",
      "http://localhost:5173", "http://127.0.0.1:5173",
      "http://localhost:8080", "http://127.0.0.1:8080",
    ].join(",")
  ).split(",").map((s) => s.trim()).filter(Boolean),
  rateLimit: toInt(process.env.RATE_LIMIT, 120),
  demo: process.argv.includes("--demo") || process.env.DEMO === "1",
};

if (!CONFIG.botToken) {
  console.error("[bridge] BOT_TOKEN не задан. Скопируйте server/.env.example в server/.env и вставьте токен из @BotFather.");
  process.exit(1);
}

/* ---------- владелец ----------
   Первый вошедший аккаунт Telegram закрепляется за мостом (server/.owner.json).
   После этого все запросы от других аккаунтов отклоняются — даже с валидной подписью. */

const OWNER_FILE = path.join(__dirname, ".owner.json");

function loadOwner() {
  try { return JSON.parse(fs.readFileSync(OWNER_FILE, "utf8")); } catch { return null; }
}

function saveOwner(o) {
  fs.writeFileSync(OWNER_FILE, JSON.stringify(o, null, 2) + "\n", "utf8");
}

/* ---------- проверка Telegram initData ----------
   secret = HMAC_SHA256("WebAppData", bot_token)
   hash   = HMAC_SHA256(data_check_string, secret)
   Из данных исключаются поля hash и signature. Подробно:
   https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app */

function validateInitData(initData) {
  if (typeof initData !== "string" || initData.length < 16 || initData.length > 8192) {
    return { ok: false, reason: "bad_length" };
  }
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "no_hash" };
  params.delete("hash");
  params.delete("signature");

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secret = crypto.createHmac("sha256", "WebAppData").update(CONFIG.botToken).digest();
  const computed = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");

  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  const authDate = Number(params.get("auth_date"));
  const ageSec = Math.floor(Date.now() / 1000) - authDate;
  if (!Number.isFinite(authDate) || ageSec < -60 || ageSec > CONFIG.maxAuthAge) {
    return { ok: false, reason: "expired" };
  }

  let user = null;
  try { user = JSON.parse(params.get("user") || "null"); } catch { /* нет user */ }
  if (CONFIG.allowedUsers.length && user && !CONFIG.allowedUsers.includes(user.id)) {
    return { ok: false, reason: "user_not_allowed" };
  }
  return { ok: true, user };
}

/* ---------- адаптер (лениво: в демо-режиме node:sqlite не нужен) ---------- */

const adapter = CONFIG.demo
  ? new (await import("./adapter-demo.mjs")).DemoAdapter()
  : new (await import("./adapter-zcode.mjs")).ZcodeAdapter();

/* Наш бот по токену: нужен экрану «Подключение» (проверка привязки в ZCode) */
let botMeCache = null;
async function getMeCached() {
  if (botMeCache) return botMeCache;
  try {
    const res = await fetch(`https://api.telegram.org/bot${CONFIG.botToken}/getMe`, { signal: AbortSignal.timeout(8_000) });
    const j = await res.json();
    if (j.ok) {
      botMeCache = { id: String(j.result.id), username: j.result.username, displayName: j.result.first_name };
      adapter.botManager?.setTokenBot?.(botMeCache);
    }
  } catch { /* повторим при следующем запросе setup */ }
  return botMeCache;
}

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

/* ---------- HTTP ---------- */

const buckets = new Map(); // ip -> { count, resetAt }

function rateLimited(ip) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + 60_000 };
    buckets.set(ip, b);
  }
  b.count += 1;
  if (buckets.size > 5_000) buckets.clear();
  return b.count > CONFIG.rateLimit;
}

function cors(res, origin) {
  if (CONFIG.allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
  }
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

async function handle(req, res) {
  const origin = req.headers.origin || "";
  cors(res, origin);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const ip = req.socket.remoteAddress || "unknown";
  if (rateLimited(ip)) {
    sendJson(res, 429, { ok: false, error: "Слишком много запросов" });
    return;
  }

  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, mode: adapter.mode, version: "1.0.0", tunnel: tunnelUrl });
    return;
  }

  if (req.method !== "POST" || !url.pathname.startsWith("/api/")) {
    sendJson(res, 404, { ok: false, error: "Not found" });
    return;
  }

  let body = {};
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    sendJson(res, 400, { ok: false, error: "Некорректный JSON" });
    return;
  }

  const auth = validateInitData(body.initData);
  if (!auth.ok) {
    log(`auth fail (${auth.reason}) с ${ip}`);
    sendJson(res, 401, { ok: false, error: "Авторизация Telegram не пройдена: " + auth.reason });
    return;
  }

  const route = url.pathname;
  const uid = auth.user?.id ?? null;

  // Привязка владельца: первый вошедший аккаунт закрепляется навсегда
  if (route === "/api/pair") {
    const owner = loadOwner();
    if (owner) {
      if (owner.userId !== uid) {
        sendJson(res, 403, { ok: false, error: "Мост уже привязан к другому аккаунту" });
        return;
      }
      sendJson(res, 200, { ok: true, paired: true, owner: { userId: owner.userId } });
      return;
    }
    if (!uid) {
      sendJson(res, 403, { ok: false, error: "В initData нет пользователя" });
      return;
    }
    const o = { userId: uid, name: auth.user?.first_name ?? "", username: auth.user?.username ?? null, pairedAt: Date.now() };
    saveOwner(o);
    log(`владелец закреплён: ${uid} (${o.name})`);
    sendJson(res, 200, { ok: true, paired: true, owner: { userId: uid } });
    return;
  }

  // Всё остальное — только для владельца (после привязки)
  const owner = loadOwner();

  try {
    if (route === "/api/auth") {
      const { id, first_name, username } = auth.user || {};
      sendJson(res, 200, {
        ok: true,
        user: { id, first_name, username },
        mode: adapter.mode,
        paired: !!owner,
        pairing: !owner,
        ownerMatch: owner ? uid === owner.userId : null,
      });
      return;
    }
    if (!owner) {
      sendJson(res, 403, { ok: false, error: "Требуется привязка владельца", pairing: true });
      return;
    }
    if (uid !== owner.userId) {
      log(`чужой пользователь ${uid} — отказано`);
      sendJson(res, 403, { ok: false, error: "Доступ только для владельца моста" });
      return;
    }
    if (route === "/api/overview") {
      sendJson(res, 200, { ok: true, ...(await adapter.overview()) });
    } else if (route === "/api/sessions") {
      sendJson(res, 200, { ok: true, ...(await adapter.sessions({ limit: body.limit })) });
    } else if (route === "/api/session") {
      if (!body.id) throw new Error("Не указан id сессии");
      sendJson(res, 200, { ok: true, ...(await adapter.sessionDetail({ id: String(body.id) })) });
    } else if (route === "/api/search") {
      const q = String(body.q || "").slice(0, 100);
      if (q.trim().length < 2) throw new Error("Запрос слишком короткий");
      sendJson(res, 200, { ok: true, ...(await adapter.search({ q, limit: body.limit })) });
    } else if (route === "/api/stats") {
      const days = Math.min(Math.max(toInt(body.days, 7), 1), 30);
      sendJson(res, 200, { ok: true, ...(await adapter.stats({ days })) });
    } else if (route === "/api/bots") {
      sendJson(res, 200, { ok: true, ...(await adapter.bots()) });
    } else if (route === "/api/bot/update") {
      sendJson(res, 200, { ok: true, ...(await adapter.botUpdate({ id: String(body.id || ""), patch: body.patch || {} })) });
    } else if (route === "/api/bot/delete") {
      sendJson(res, 200, { ok: true, ...(await adapter.botDelete({ id: String(body.id || "") })) });
    } else if (route === "/api/bot/link") {
      sendJson(res, 200, { ok: true, ...(await adapter.botLink({ token: String(body.token || "") })) });
    } else if (route === "/api/projects") {
      sendJson(res, 200, { ok: true, ...(await adapter.projects()) });
    } else if (route === "/api/setup") {
      const me = await getMeCached();
      const dbOk = CONFIG.demo ? true : (adapter.dbOk ?? false);
      const status = await adapter.setupStatus({ dbOk, mode: adapter.mode });
      status.ownerPaired = !!loadOwner();
      status.tunnel = {
        url: tunnelUrl,
        botChatPaired: botLink ? botLink.paired : false,
        botConflict: botLink ? botLink.conflict : false,
      };
      status.billing = {
        pro: botLink?.paired && zbotRef ? zbotRef.isPro(botLink.chatId) : false,
        freeMinutes: FREE_TUNNEL_MIN,
      };
      sendJson(res, 200, { ok: true, ...status });
    } else {
      sendJson(res, 404, { ok: false, error: "Not found" });
    }
  } catch (err) {
    log(`ошибка ${route}: ${err.message}`);
    sendJson(res, 500, { ok: false, error: err.message });
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    log(`внутренняя ошибка: ${err.message}`);
    try { sendJson(res, 500, { ok: false, error: "internal" }); } catch { /* ответ уже ушёл */ }
  });
});

/* ---------- WebSocket ---------- */

const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(text) {
  for (const ws of wss.clients) {
    if (ws.isAuthed && ws.readyState === ws.OPEN) ws.send(text);
  }
}

adapter.events.on("refresh", (ev) => broadcast(JSON.stringify(ev)));

wss.on("connection", (ws, req) => {
  ws.isAuthed = false;
  const origin = req.headers.origin || "";
  if (origin && !CONFIG.allowedOrigins.includes(origin)) {
    ws.close(1008, "origin not allowed");
    return;
  }
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  const authTimer = setTimeout(() => {
    if (!ws.isAuthed) ws.close(4001, "auth timeout");
  }, 5_000);

  ws.on("message", (raw) => {
    if (ws.isAuthed) return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type !== "auth") return;
    const auth = validateInitData(msg.initData);
    clearTimeout(authTimer);
    if (!auth.ok) {
      ws.send(JSON.stringify({ type: "auth_fail", reason: auth.reason }));
      ws.close(4003, "auth failed");
      return;
    }
    ws.isAuthed = true;
    ws.send(JSON.stringify({ type: "auth_ok", mode: adapter.mode }));
  });

  ws.on("close", () => clearTimeout(authTimer));
  ws.on("error", () => clearTimeout(authTimer));
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* noop */ }
  }
}, 30_000);

wss.on("close", () => clearInterval(heartbeat));

/* ---------- запуск ---------- */

try {
  adapter.start();
} catch (err) {
  console.error(`[bridge] Не удалось запустить адаптер «${adapter.mode}»: ${err.message}`);
  if (adapter.mode === "zcode") {
    console.error("[bridge] Проверьте, что ZCODE установлен и база существует:");
    console.error("[bridge]   " + (process.env.ZCODE_DB || "~/.zcode/cli/db/db.sqlite"));
    console.error("[bridge] Либо запустите в демо-режиме: npm run demo");
  }
  process.exit(1);
}

server.listen(CONFIG.port, () => {
  log(`мост запущен: режим=${adapter.mode}, порт=${CONFIG.port}`);
  log(`разрешённые origin: ${CONFIG.allowedOrigins.join(", ")}`);
  if (CONFIG.allowedUsers.length) log(`белый список Telegram id: ${CONFIG.allowedUsers.join(", ")}`);
  else log("белый список id не задан — пройдёт любой пользователь с валидной подписью (можно ограничить через ALLOWED_USER_IDS)");
});

/* ---------- автотуннель + кнопка в боте (настоящее подключение) ---------- */

export let tunnelUrl = null;
let botLink = null;
let tunnel = null;
let zbotRef = null;

async function startExposure() {
  if (process.argv.includes("--no-expose") || process.env.EXPOSE === "0") {
    log("автотуннель отключён (--no-expose)");
    return;
  }
  const candidates = [process.env.CLOUDFLARED_PATH, "cloudflared", path.join(__dirname, "bin", "cloudflared.exe")].filter(Boolean);
  const bin = candidates.find((p) => {
    try {
      if (fs.existsSync(p)) return true;
      execSync(`where "${p}"`, { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  });
  if (!bin) {
    log("cloudflared не найден: winget install Cloudflare.cloudflared — и перезапустить мост");
    return;
  }
  tunnel = new Tunnel({ port: CONFIG.port, bin });
  botLink = new BotLink({ token: CONFIG.botToken, dir: __dirname, log });
  zbotRef = new ZcodeBot({
    token: CONFIG.botToken,
    dir: __dirname,
    log,
    getContext: () => ({
      tunnelUrl,
      mode: adapter.mode,
      dbOk: CONFIG.demo ? true : !!adapter.dbOk,
    }),
  });
  zbotRef.sendLaunchIfPossible = (chatId) => tunnelUrl && botLink.sendLaunch(chatId, tunnelUrl);
  zbotRef.restartTunnel = async () => {
    tunnel.stopped = false;
    const u = await tunnel.start();
    if (u) { tunnelUrl = u; log(`туннель (Pro): ${u}`); await botLink.announce(u); }
  };
  botLink.onMessage = (msg) => zbotRef.handleMessage(msg);
  botLink.onCallback = (q) => zbotRef.handleCallback(q);
  botLink.startPolling();

  const url = await tunnel.start();
  if (url) {
    tunnelUrl = url;
    log(`туннель: ${url}`);
    log("если бот в Telegram ещё не связан — отправьте ему /start, придёт кнопка открытия");
    await botLink.announce(url);

    // бесплатный лимит: туннель закрывается через FREE_TUNNEL_MIN минут, Pro снимает лимит
    const armLimit = () => {
      if (botLink.paired && zbotRef.isPro(botLink.chatId)) return;
      setTimeout(async () => {
        if (botLink.paired && zbotRef.isPro(botLink.chatId)) return;
        tunnel.stopped = true;
        try { tunnel.proc?.kill(); } catch { /* noop */ }
        tunnelUrl = null;
        log("бесплатный лимит туннеля истёк");
        if (botLink.paired) await zbotRef.notifyTunnelExpired(botLink.chatId);
      }, FREE_TUNNEL_MIN * 60_000);
    };
    armLimit();
  } else {
    log("туннель не поднялся — адрес можно указать вручную любым способом (cloudflared/ngrok)");
  }
}

startExposure();

function shutdown() {
  log("остановка…");
  try { tunnel?.stop(); } catch { /* noop */ }
  try { botLink?.stop(); } catch { /* noop */ }
  try { adapter.stop(); } catch { /* noop */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2_000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
