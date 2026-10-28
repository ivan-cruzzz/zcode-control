/* Отправка сообщений от аккаунта владельца (MTProto/GramJS).
   Одноразовый вход — npm run user (см. login-user.mjs).
   Сессия лежит в .user-session; ключи api — в .env (USER_API_ID/HASH).
   Сессия и ключи никогда не логируются и не покидают ваш ПК. */

import fs from "node:fs";
import path from "node:path";

export class UserTelegram {
  constructor({ dir, log = () => {} }) {
    this.dir = dir;
    this.log = log;
    this.sessionFile = path.join(dir, ".user-session");
    this.client = null;
    this._connecting = null;
  }

  get available() {
    try {
      return Boolean(
        fs.readFileSync(this.sessionFile, "utf8").trim() &&
        Number(process.env.USER_API_ID) &&
        process.env.USER_API_HASH
      );
    } catch {
      return false;
    }
  }

  async getClient() {
    if (this.client) return this.client;
    if (!this.available) throw new Error("needUserLogin");
    if (this._connecting) return this._connecting;
    this._connecting = (async () => {
      const { TelegramClient } = await import("telegram");
      const { StringSession } = await import("telegram/sessions/index.js");
      const session = new StringSession(fs.readFileSync(this.sessionFile, "utf8").trim());
      const client = new TelegramClient(
        session,
        Number(process.env.USER_API_ID),
        process.env.USER_API_HASH,
        { connectionRetries: 3 },
      );
      await client.connect();
      try { client.setLogLevel?.("error"); } catch { /* noop */ }
      this.client = client;
      this.log("MTProto-аккаунт подключён: сообщения из мини-аппа уходят от вашего имени");
      return client;
    })();
    try {
      return await this._connecting;
    } finally {
      this._connecting = null;
    }
  }

  /** Отправить текст в чат бота от имени владельца → ZCode получит его как обычное сообщение. */
  async sendToBot(username, text) {
    const client = await this.getClient();
    await client.sendMessage(username, { message: text });
    return { sent: true };
  }

  stop() {
    try { this.client?.disconnect(); } catch { /* noop */ }
    this.client = null;
  }
}
