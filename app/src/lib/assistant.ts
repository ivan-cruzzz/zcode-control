/* Живой ассистент чата: понимает обычные вопросы (без слэша)
   и отвечает по реальным данным моста. Слэш-команды по-прежнему работают. */

import type { AppClient } from "@/lib/api";
import { fmtTokens, fmtRel } from "@/lib/format";
import type { ViewId } from "@/components/Dock";
import type { ThemeMode } from "@/lib/tg";
import { runCommand } from "@/lib/commands";

export interface ChatCtx {
  client: AppClient;
  status: string;
  goto: (v: ViewId) => void;
  setTheme: (m: ThemeMode) => void;
  clear: () => void;
  openSession: (id: string) => void;
}

const has = (t: string, ...words: string[]) => words.some((w) => t.includes(w));

export async function answer(raw: string, ctx: ChatCtx): Promise<string> {
  const text = raw.trim();
  if (text.startsWith("/")) return runCommand(text, ctx);
  const t = text.toLowerCase();

  try {
    // «что делает / чем занят / статус / как дела»
    if (has(t, "что делает", "чем занят", "статус", "как дела", "что происходит", "состояние")) {
      const s = await ctx.client.setup();
      const o = await ctx.client.overview();
      const st = o.status || {};
      return [
        `${st.state === "active" ? "ZCODE сейчас работает" : st.state === "idle" ? "ZCODE простаивает" : "данных нет"}.`,
        st.session?.title ? `Сессия: «${st.session.title.slice(0, 60)}» (${fmtRel(st.updatedAt)}).` : "",
        st.model ? `Модель: ${st.model}, режим ${st.mode || "—"}.` : "",
        `Токены сегодня: ${fmtTokens(o.stats?.tokensToday)}, задач в работе: ${o.stats?.todosActive ?? 0}.`,
        `Мост: ${s.bridge.dbOk ? "читает базу ZCODE" : "база недоступна"}, бот: ${s.bot.linkedInZcode ? (s.bot.polling ? "принимает команды" : "привязан, поллинг выключен") : "не привязан к ZCode"}.`,
      ].filter(Boolean).join("\n");
    }

    // «сессии / последние / чем занимался»
    if (has(t, "сесси", "последние", "проекты", "чем занимался")) {
      const { sessions } = await ctx.client.sessions(5);
      return sessions.length
        ? "Последние сессии:\n" + sessions.map((s: any) => `• ${s.title?.slice(0, 50)} — ${fmtTokens(s.tokens)} ток., ${fmtRel(s.timeUpdated)}`).join("\n")
        : "Сессий нет.";
    }

    // «задачи / что осталось»
    if (has(t, "задач", "todo", "туду", "осталось сделать")) {
      const { sessions } = await ctx.client.sessions(10);
      for (const s of sessions) {
        const d = await ctx.client.sessionDetail(s.id);
        const active = (d.todos || []).filter((x: any) => x.status !== "completed");
        if (active.length) {
          return `Активные задачи (${s.title?.slice(0, 40)}):\n` +
            active.map((x: any) => `• ${x.content} [${x.status}]`).join("\n");
        }
      }
      return "Активных задач не нашёл.";
    }

    // «токены / статистика»
    if (has(t, "токен", "расход", "статистик", "потратил")) {
      const { daily, models } = await ctx.client.stats(7);
      const total = daily.reduce((a: number, d: any) => a + d.tokens, 0);
      const top = models?.[0];
      return `За 7 дней: ${fmtTokens(total)} токенов. Сегодня: ${fmtTokens(daily.at(-1)?.tokens)}.` +
        (top ? `\nТоп модель: ${top.model} (${fmtTokens(top.tokens)}).` : "") +
        `\nГрафик — на Обзоре.`;
    }

    // «найди <слово>»
    if (has(t, "найди", "поищи", "где упоминает", "поиск")) {
      const q = text.replace(/^.*?(найди|поищи|где упоминает|поиск)\s*/i, "").trim();
      if (q.length >= 2) {
        const { results } = await ctx.client.search(q, 5);
        return results.length
          ? `Нашёл ${results.length}:\n` + results.map((r: any) => `• «${r.text.slice(0, 60)}» — ${r.sessionTitle.slice(0, 40)} (${fmtRel(r.time)})`).join("\n")
          : `По «${q}» ничего нет.`;
      }
      return "Напишите: найди <слово>.";
    }

    // «бот / поллинг»
    if (has(t, "бот", "поллинг", "телеграм")) {
      const s = await ctx.client.setup();
      const b = s.bot;
      return `Бот @${b.username ?? "—"}: ${b.linkedInZcode ? (b.polling ? "привязан к ZCode, поллинг активен — команды в чат выполняются" : "привязан, но поллинг выключен") : "ещё не привязан к ZCode (Обзор → Привязать)"}.`;
    }

    if (/^(привет|хай|hello|hi|здравствуй)/.test(t)) return "Привет! Спросите: «что делает ZCODE», «какие сессии», «найди …», «токены за неделю» — или используйте / команды.";
    if (has(t, "спасибо", "благодар")) return "Всегда рядом.";
    if (has(t, "помоги", "что ты умеешь", "умеешь", "help")) {
      return [
        "Я живой пульт вашего ZCODE. Спросите обычными словами:",
        "«что делает ZCODE?» · «какие сессии?» · «какие задачи?» ·",
        "«сколько токенов?» · «найди <слово>» · «расскажи про бота».",
        "Слэш-команды тоже работают: /help.",
      ].join("\n");
    }

    return "Я понимаю вопросы про ZCODE: «что делает», «какие сессии», «какие задачи», «токены», «найди <слово>», «про бота». Слэш-команды — /help. Писать напрямую в сессию можно из карточки сессии (вкладка Сессии).";
  } catch (e) {
    return "Ошибка: " + (e as Error).message;
  }
}
