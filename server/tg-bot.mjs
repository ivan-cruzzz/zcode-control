/* Рабочий бот ZCODE Control: команды, живой статус и оплата подписки
   Telegram Stars (XTR). Pro снимает лимит времени туннеля.
   Платежи: sendInvoice (XTR, без provider-токена) → answerPreCheckoutQuery →
   successful_payment продлевает подписку на 30 дней (.billing.json, локально). */

import fs from "node:fs";
import path from "node:path";

const APP_URL = "https://ivan-cruzzz.github.io/zcode-control/";
const STARS_PER_MONTH = 100;
const PRO_DAYS = 30;
const FREE_TUNNEL_MIN = 60;

export class ZcodeBot {
  constructor({ token, dir, log = () => {}, getContext }) {
    this.token = token;
    this.dir = dir;
    this.log = log;
    this.getContext = getContext; // () => ({ tunnelUrl, mode, dbOk, ownerPaired, bot })
    this.billingFile = path.join(dir, ".billing.json");
    this.sendLaunchIfPossible = null; // мост подставляет свою кнопку туннеля
    this.restartTunnel = null;        // мост подставляет перезапуск туннеля после оплаты
  }

  /* --- подписки --- */

  _readBilling() {
    try { return JSON.parse(fs.readFileSync(this.billingFile, "utf8")); } catch { return {}; }
  }

  proUntil(chatId) {
    return this._readBilling()[String(chatId)] ?? 0;
  }

  isPro(chatId) {
    return this.proUntil(chatId) > Date.now();
  }

  _grant(chatId, days) {
    const b = this._readBilling();
    const base = Math.max(Date.now(), b[String(chatId)] ?? 0);
    b[String(chatId)] = base + days * 86_400_000;
    fs.writeFileSync(this.billingFile, JSON.stringify(b, null, 2) + "\n", "utf8");
    return b[String(chatId)];
  }

  /* --- отправка --- */

  async api(method, body, timeoutMs = 12_000) {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.json();
  }

  appButton() {
    return [{ text: "Открыть ZCODE Control", web_app: { url: APP_URL } }];
  }

  async sendMenu(chatId) {
    await this.api("sendMessage", {
      chat_id: chatId,
      text: "ZCODE Control — пульт вашего ZCODE.\n/status — живой статус\n/sub — подписка Pro (без лимита туннеля)",
      reply_markup: { inline_keyboard: [this.appButton(), [{ text: `⭐ Pro — ${STARS_PER_MONTH} звёзд/мес`, callback_data: "sub" }]] },
    });
  }

  async sendStatus(chatId) {
    const c = this.getContext();
    const pro = this.isPro(chatId);
    const until = this.proUntil(chatId);
    const lines = [
      `состояние: ${c.tunnelUrl ? "туннель активен" : "туннель не поднят"}`,
      `база ZCODE: ${c.dbOk ? "подключена" : "нет"}`,
      `режим: ${c.mode}`,
      `подписка: ${pro ? "Pro до " + new Date(until).toLocaleDateString("ru-RU") : `бесплатно (туннель ${FREE_TUNNEL_MIN} мин за запуск)`}`,
    ];
    await this.api("sendMessage", {
      chat_id: chatId,
      text: lines.join("\n"),
      reply_markup: { inline_keyboard: pro ? [this.appButton()] : [this.appButton(), [{ text: `⭐ Оформить Pro — ${STARS_PER_MONTH}`, callback_data: "sub" }]] },
    });
  }

  async sendInvoice(chatId) {
    const j = await this.api("sendInvoice", {
      chat_id: chatId,
      title: "ZCODE Control Pro",
      description: `Безлимитный туннель и приоритетные обновления. ${PRO_DAYS} дней.`,
      payload: "pro_month",
      currency: "XTR",
      prices: [{ label: `Pro на ${PRO_DAYS} дней`, amount: STARS_PER_MONTH }],
    }, 15_000);
    if (!j.ok) this.log(`sendInvoice: ${j.description}`);
  }

  async handleCallback(q) {
    if (q.data === "sub") {
      await this.sendInvoice(q.from.id);
      await this.api("answerCallbackQuery", { callback_query_id: q.id });
    }
  }

  async handlePreCheckout(q) {
    const ok = q.currency === "XTR" && q.invoice_payload === "pro_month";
    await this.api("answerPreCheckoutQuery", { pre_checkout_query_id: q.id, ok, error_message: ok ? undefined : "Платёж не распознан" });
  }

  async handlePaid(msg, chatId) {
    const until = this._grant(chatId, PRO_DAYS);
    this.log(`оплата принята: chat ${chatId}, Pro до ${new Date(until).toISOString()}`);
    await this.api("sendMessage", {
      chat_id: chatId,
      text: `⭐ Оплата получена — Pro активен до ${new Date(until).toLocaleDateString("ru-RU")}. Лимит туннеля снят.`,
      reply_markup: { inline_keyboard: [this.appButton()] },
    });
    if (typeof this.restartTunnel === "function") {
      try { await this.restartTunnel(); } catch { /* noop */ }
    }
  }

  async notifyTunnelExpired(chatId) {
    await this.api("sendMessage", {
      chat_id: chatId,
      text: `⏳ Бесплатный туннель (${FREE_TUNNEL_MIN} мин) закрыт. Оформите Pro — без лимита.`,
      reply_markup: { inline_keyboard: [[{ text: `⭐ Pro — ${STARS_PER_MONTH} звёзд/мес`, callback_data: "sub" }]] },
    });
  }

  /* --- диспетчер сообщений (вызывается из BotLink) --- */

  async handleMessage(msg) {
    const chatId = msg.chat.id;
    try {
      if (msg.successful_payment) return this.handlePaid(msg, chatId);
      if (msg.text === "/start") {
        if (this.getContext().tunnelUrl && this.sendLaunchIfPossible) await this.sendLaunchIfPossible(chatId);
        return this.sendMenu(chatId);
      }
      if (msg.text === "/status") return this.sendStatus(chatId);
      if (msg.text === "/sub" || msg.text === "/buy") return this.sendInvoice(chatId);
      return this.sendStatus(chatId); // любой другой текст — живой статус
    } catch (e) {
      this.log(`ошибка бота: ${e.message}`);
    }
  }
}

export { FREE_TUNNEL_MIN, STARS_PER_MONTH };
