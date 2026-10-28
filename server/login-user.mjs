/* Одноразовый вход вашего Telegram-аккаунта (MTProto через GramJS).
   Это ключ к полной автоматизации: с авторизованным аккаунтом мост
   отправляет текст из мини-аппа в чат бота ОТ ВАШЕГО ИМЕНИ — и ZCode
   получает его ровно так же, как если бы вы напечатали в Telegram.

   Запуск:  npm run user
   Нужно один раз: api_id и api_hash с https://my.telegram.org
   (API development tools → создать приложение), телефон, код из Telegram
   и пароль 2FA, если он включён. Сессия сохраняется в .user-session
   (локально, в git не попадает) — больше этот шаг не повторяется. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env может уже содержать BOT_TOKEN — подгрузим, чтобы не потерять
if (fs.existsSync(path.join(__dirname, ".env"))) {
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => rl.question(q);

let apiId = Number(process.env.USER_API_ID || "");
let apiHash = process.env.USER_API_HASH || "";

if (!apiId || !apiHash) {
  console.log("\nНужны ключи разработчика Telegram (один раз, 2 минуты):");
  console.log("1. Откройте https://my.telegram.org → API development tools");
  console.log("2. Создайте приложение (любое название) → скопируйте api_id и api_hash\n");
  apiId = Number((await ask("api_id: ")).trim());
  apiHash = (await ask("api_hash: ")).trim();
  if (!Number.isFinite(apiId) || apiHash.length < 30) {
    console.error("Ключи выглядят некорректно. Запустите npm run user ещё раз.");
    process.exit(1);
  }
}

const phone = (await ask("Телефон (в международном формате, напр. +79…): ")).trim();

const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
  connectionRetries: 5,
});

await client.start({
  phone: () => ask("Код подтверждения придёт в Telegram. Введите код: "),
  password: async () => await ask("Пароль 2FA (если включён, иначе Enter): "),
  onError: (err) => console.error("Ошибка входа:", err.message),
});

// сохраняем сессию и ключи, чтобы мост сам отправлял дальше
const session = client.session.save();
fs.writeFileSync(path.join(__dirname, ".user-session"), session, "utf8");

const envPath = path.join(__dirname, ".env");
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const upsert = (key, val) => {
  if (new RegExp(`^${key}=`, "m").test(env)) env = env.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${val}`);
  else env += (env.endsWith("\n") || env === "" ? "" : "\n") + `${key}=${val}\n`;
};
upsert("USER_API_ID", String(apiId));
upsert("USER_API_HASH", apiHash);
fs.writeFileSync(envPath, env, "utf8");

const me = await client.getMe();
console.log(`\nГотово! Вы вошли как ${me.username ? "@" + me.username : me.firstName} (id ${me.id}).`);
console.log("Сессия сохранена в server/.user-session. Теперь сообщения из мини-аппа");
console.log("уходят в ZCODE автоматически — без переброса в чат Telegram.");

rl.close();
await client.disconnect();
process.exit(0);
