/* Плавающий док — miniDESIGN §3.2 / [S6]: стекло, 48×48 пункты, актив — синий + точка. */

import { Activity, TerminalSquare, List, Bot, Settings } from "lucide-react";
import { haptic } from "@/lib/tg";
import { cn } from "@/lib/utils";

export type ViewId = "overview" | "sessions" | "console" | "bots" | "settings";

const ITEMS: { id: ViewId; label: string; icon: typeof Activity }[] = [
  { id: "overview", label: "Обзор", icon: Activity },
  { id: "sessions", label: "Сессии", icon: List },
  { id: "console", label: "Консоль", icon: TerminalSquare },
  { id: "bots", label: "Боты", icon: Bot },
  { id: "settings", label: "Ещё", icon: Settings },
];

export function Dock({ view, onNavigate }: { view: ViewId; onNavigate: (v: ViewId) => void }) {
  return (
    <nav
      aria-label="Основная навигация"
      className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2"
    >
      <div className="flex items-center gap-1 rounded-[16px] border border-white/50 bg-white/80 px-2 py-2 shadow-[0_20px_48px_rgba(0,0,0,0.105),0_3px_10px_rgba(0,0,0,0.045)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#1f2023]/85">
        {ITEMS.map(({ id, label, icon: Icon }) => {
          const active = view === id;
          return (
            <button
              key={id}
              type="button"
              aria-label={label}
              aria-current={active ? "page" : undefined}
              onClick={() => {
                if (!active) haptic.tap();
                onNavigate(id);
              }}
              className={cn(
                "relative grid h-12 w-12 place-items-center rounded-[12px] transition-colors duration-150",
                active ? "bg-blue-50 dark:bg-blue-500/10" : "hover:bg-muted",
              )}
            >
              <Icon
                size={20}
                strokeWidth={2}
                className={cn(
                  "transition-colors duration-150",
                  active ? "text-[#2563EB] dark:text-[#3B82F6]" : "text-[#374151] dark:text-gray-400",
                )}
              />
              <span
                aria-hidden
                className={cn(
                  "absolute bottom-1 h-1 w-1 rounded-full transition-all duration-150",
                  active ? "bg-[#2563EB] dark:bg-[#3B82F6]" : "bg-transparent",
                )}
              />
              <span className="sr-only">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
