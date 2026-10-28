/* Команды консоли. Обрабатываются локально поверх API моста —
   это команды самого пульта, а не ZCODE (канал ZCODE — чат бота). */

import type { AppClient } from "@/lib/api";
import { fmtTokens } from "@/lib/format";
import type { ViewId } from "@/components/Dock";
import type { ThemeMode } from "@/lib/tg";

export type ConsoleMsg = { id: string; role: "user" | "assistant"; text: string; time: number };

export interface CommandCtx {
  client: AppClient;
  status: string;
  goto: (v: ViewId) => void;
  setTheme: (m: ThemeMode) => void;
  clear: () => void;
}

export const COMMAND_DEFS: { id: string; label: string; description: string }[] = [
  { id: "help", label: "/help", description: "список команд" },
  { id: "status", label: "/status", description: "состояние моста и ZCODE" },
  { id: "sessions", label: "/sessions", description: "последние сессии" },
  { id: "bots", label: "/bots", description: "боты и поллинг" },
  { id: "stats", label: "/stats", description: "токены за 7 дней" },
  { id: "setup", label: "/setup", description: "чек-лист подключения" },
  { id: "goto", label: "/goto", description: "goto <overview|sessions|bots|settings>" },
  { id: "theme", label: "/theme", description: "theme <dark|light|auto>" },
  { id: "clear", label: "/clear", description: "очистить консоль" },
];

const HELP = [
  "Команды пульта:",
  ...COMMAND_DEFS.map((c) => `${c.label} — ${c.description}`),
  "",
  "Команды самому ZCODE отправляйте боту в чат —",
  "это его штатный канал; консоль управляет пультом.",
].join("\n");

export async function runCommand(raw: string, ctx: CommandCtx): Promise<string> {
  const input = raw.trim();
  const [cmdRaw, ...args] = input.split(/\s+/);
  const cmd = cmdRaw.toLowerCase();

  switch (cmd) {
    case "/help":
      return HELP;

    case "/status": {
      try {
        const s = await ctx.client.setup();
        const b = s.bot;
        return [
          `мост: ${s.bridge.mode}, база ZCODE: ${s.bridge.dbOk ? "ок" : "нет"}`,
          `владелец: ${s.ownerPaired ? "закреплён" : "не закреплён"}`,
          `бот: @${b.username ?? "—"} — ${b.linkedInZcode ? (b.polling ? "поллинг активен" : "привязан, поллинг выключен") : "не привязан в ZCode"}`,
          `соединение: ${ctx.status}`,
        ].join("\n");
      } catch (e) {
        return "Ошибка: " + (e as Error).message;
      }
    }

    case "/sessions": {
      try {
        const { sessions } = await ctx.client.sessions(5);
        return sessions.length
          ? sessions.map((s: any) => `• ${(s.title || "").slice(0, 48)} — ${fmtTokens(s.tokens)} ток.`).join("\n")
          : "Сессий нет.";
      } catch (e) {
        return "Ошибка: " + (e as Error).message;
      }
    }

    case "/bots": {
      try {
        const { bots, polling } = await ctx.client.bots();
        return bots.length
          ? [`поллинг: ${polling ? "активен" : "выключен"}`, ...bots.map((b: any) => `• ${b.displayName} — ${b.enabled ? "включён" : "выключен"}, ${b.replyMode}`)].join("\n")
          : "Ботов нет.";
      } catch (e) {
        return "Ошибка: " + (e as Error).message;
      }
    }

    case "/stats": {
      try {
        const { daily } = await ctx.client.stats(7);
        const total = daily.reduce((a: number, d: any) => a + d.tokens, 0);
        const best = daily.reduce((a: any, d: any) => (d.tokens > a.tokens ? d : a), daily[0]);
        return `за 7 дней: ${fmtTokens(total)} токенов\nпик: ${fmtTokens(best.tokens)} (${best.date.slice(5)})\nграфик — на Обзоре`;
      } catch (e) {
        return "Ошибка: " + (e as Error).message;
      }
    }

    case "/setup": {
      ctx.goto("overview");
      return "Чек-лист подключения — на Обзоре.";
    }

    case "/goto": {
      const map: Record<string, ViewId> = { overview: "overview", sessions: "sessions", console: "console", bots: "bots", settings: "settings" };
      const target = map[(args[0] || "").toLowerCase()];
      if (!target) return "goto <overview|sessions|bots|settings>";
      ctx.goto(target);
      return `Открыл «${target}».`;
    }

    case "/theme": {
      const v = (args[0] || "").toLowerCase();
      if (v === "dark" || v === "light" || v === "auto") {
        ctx.setTheme(v as ThemeMode);
        return `Тема: ${v}.`;
      }
      return "theme <dark|light|auto>";
    }

    case "/clear":
      ctx.clear();
      return "";

    default:
      return input.startsWith("/")
        ? `Неизвестная команда ${cmd}. /help — список.`
        : "Консоль понимает команды через «/». Сообщения самому ZCODE — в чат бота.";
  }
}
