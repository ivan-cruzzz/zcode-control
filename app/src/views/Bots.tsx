/* Боты: список с тумблерами + карточка настроек бота (порт v1.3). */

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import type { AppClient, BotItem } from "@/lib/api";
import { fmtDir } from "@/lib/format";
import { haptic, tg } from "@/lib/tg";
import { cn } from "@/lib/utils";

const REPLY_MODES = [
  { id: "assistant_changes", title: "Стандартный", desc: "Текст ассистента и изменения файлов." },
  { id: "assistant_toolcalls_changes", title: "Подробный", desc: "Плюс вызовы инструментов." },
  { id: "summary_changes", title: "Кратко", desc: "Только сводка изменений." },
  { id: "streaming_card", title: "Живая карточка", desc: "Обновляется в реальном времени." },
];

const COMMAND_LABELS: Record<string, string> = {
  status: "/status", new: "/new", workspace: "Проект", model: "Модель",
  mode: "Режим", thoughtLevel: "Глубина", reply: "Ответ",
};

export function Bots({ client, refreshTick }: { client: AppClient; refreshTick: number }) {
  const [bots, setBots] = useState<BotItem[]>([]);
  const [polling, setPolling] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const rerender = () => setTick((x) => x + 1);

  useEffect(() => {
    client.bots().then((d: any) => { setBots(d.bots || []); setPolling(!!d.polling); }).catch(() => {});
  }, [client, refreshTick]);

  async function toggle(id: string) {
    const b = bots.find((x) => x.id === id);
    if (!b) return;
    haptic.impact();
    try {
      await client.botUpdate(id, { enabled: !b.enabled });
      setBots((prev) => prev.map((x) => (x.id === id ? { ...x, enabled: !x.enabled, running: !x.enabled && x.running } : x)));
    } catch { /* noop */ }
  }

  return (
    <div>
      <header className="flex items-center gap-2.5 px-4 pb-2 pt-1">
        <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Боты</h1>
        <span className="ml-auto font-mono text-[12px] text-muted-foreground">поллинг: {polling ? "активен" : "выкл"}</span>
      </header>

      <div className="space-y-2 px-4">
        {bots.map((b) => (
          <div key={b.id} className="flex items-center gap-3 rounded-[16px] border border-border bg-card p-3.5">
            <button onClick={() => { haptic.impact(); setOpen(b.id); }} className="min-w-0 flex-1 text-left">
              <div className="flex items-center gap-2 text-[14px] font-semibold">
                <span className="truncate">{b.displayName}</span>
                {b.running ? <span className="rounded-full border border-[#22C55E]/40 bg-[#22C55E]/10 px-1.5 text-[10px] font-bold text-[#16A34A]">работает</span>
                  : b.enabled ? <span className="rounded-full border border-[#F97316]/40 bg-[#F97316]/10 px-1.5 text-[10px] text-[#C2410C]">ожидает</span>
                  : <span className="rounded-full border border-border px-1.5 text-[10px] text-muted-foreground">выключен</span>}
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                {b.provider}{b.workspacePath ? " · " + fmtDir(b.workspacePath) : ""}
              </div>
            </button>
            <button
              role="switch"
              aria-checked={b.enabled}
              aria-label={`Бот ${b.displayName} включён?`}
              onClick={() => toggle(b.id)}
              className={cn("relative h-[27px] w-[44px] shrink-0 rounded-full border transition-colors", b.enabled ? "border-[#2563EB] bg-[#2563EB]/15" : "border-border bg-muted")}
            >
              <span className={cn("absolute top-[2px] h-[21px] w-[21px] rounded-full transition-all", b.enabled ? "left-[19px] bg-[#2563EB]" : "left-[2px] bg-muted-foreground")} />
            </button>
          </div>
        ))}
        {!bots.length && <p className="rounded-[16px] border border-border bg-card p-4 text-center text-[13px] text-muted-foreground">Ботов нет. Создайте у @BotFather и привяжите в панели Bots.</p>}
      </div>

      {open && <BotSheet key={open + ":" + tick} id={open} client={client} bots={bots} onChange={setBots} onClose={() => setOpen(null)} />}
    </div>
  );
}

function BotSheet({ id, client, bots, onChange, onClose }: { id: string; client: AppClient; bots: BotItem[]; onChange: (b: BotItem[]) => void; onClose: () => void }) {
  const bot = bots.find((b) => b.id === id);
  const [projects, setProjects] = useState<{ id: string; directory: string }[]>([]);
  const [armed, setArmed] = useState(false);
  const [name, setName] = useState(bot?.name || "");

  useEffect(() => {
    client.projects().then((d: any) => setProjects(d.projects || [])).catch(() => {});
  }, [client]);

  useEffect(() => {
    tg?.BackButton?.show?.();
    const h = () => onClose();
    tg?.BackButton?.onClick?.(h);
    return () => { tg?.BackButton?.offClick?.(h); tg?.BackButton?.hide?.(); };
  }, [onClose]);

  if (!bot) return null;

  async function save(patch: any) {
    try {
      await client.botUpdate(bot.id, patch);
      if (patch.allowedWorkspaces !== undefined) bot.allowedWorkspaces = patch.allowedWorkspaces === "*" ? ["*"] : patch.allowedWorkspaces;
      if (patch.allowedCommands !== undefined) bot.allowedCommands = { ...bot.allowedCommands, ...patch.allowedCommands };
      if (patch.name !== undefined) bot.name = patch.name;
      haptic.notify();
      onChange(bots.map((b) => (b.id === bot.id ? { ...bot } : b)));
    } catch { /* noop */ }
  }

  const wsAll = (bot.allowedWorkspaces || []).includes("*");

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background" role="dialog" aria-label="Настройки бота">
      <header className="flex items-center gap-3 border-b border-border px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
        <button onClick={onClose} aria-label="Назад" className="grid h-10 w-10 place-items-center rounded-[12px] border border-border transition-transform active:scale-90">
          <X size={18} />
        </button>
        <div className="min-w-0 flex-1 truncate text-[14px] font-semibold">{bot.displayName}</div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <Section title="Гранулярность ответов">
          {REPLY_MODES.map((m) => (
            <button key={m.id} onClick={() => { haptic.tap(); save({ replyMode: m.id }); }}
              className="flex w-full items-start gap-3 border-b border-border/60 py-3 text-left last:border-0">
              <span className={cn("mt-1 h-[18px] w-[18px] shrink-0 rounded-full border-2", bot.replyMode === m.id ? "border-[#2563EB] bg-[#2563EB]" : "border-muted-foreground")} />
              <span>
                <span className="block text-[14px] font-semibold">{m.title}</span>
                <span className="block text-xs text-muted-foreground">{m.desc}</span>
              </span>
            </button>
          ))}
        </Section>

        <Section title="Доступ к проектам">
          <div className="flex flex-wrap gap-2 py-1.5">
            <Chip on={wsAll} onClick={() => save({ allowedWorkspaces: ["*"] })}>Все проекты</Chip>
            {projects.map((p) => {
              const on = !wsAll && bot.allowedWorkspaces.includes(p.id);
              return <Chip key={p.id} on={on} onClick={() => {
                let list: string[] = wsAll ? [] : [...bot.allowedWorkspaces];
                list = list.includes(p.id) ? list.filter((x) => x !== p.id) : [...list, p.id];
                if (list.length) save({ allowedWorkspaces: list });
              }}>{fmtDir(p.directory)}</Chip>;
            })}
          </div>
        </Section>

        <Section title="Команды в чате">
          <div className="flex flex-wrap gap-2 py-1.5">
            {Object.entries(COMMAND_LABELS).map(([key, label]) => (
              <Chip key={key} on={bot.allowedCommands?.[key] !== false} onClick={() => save({ allowedCommands: { ...bot.allowedCommands, [key]: bot.allowedCommands?.[key] === false } })}>{label}</Chip>
            ))}
          </div>
        </Section>

        <Section title="Имя">
          <div className="flex gap-2 py-1.5">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder={bot.displayName}
              className="h-11 min-w-0 flex-1 rounded-[12px] border border-border bg-background px-3 text-[15px] outline-none focus:border-foreground/40" />
            <button onClick={() => save({ name })} className="h-11 shrink-0 rounded-[12px] bg-foreground px-4 text-[14px] font-semibold text-background transition-transform active:scale-95">Сохранить</button>
          </div>
        </Section>

        <button
          onClick={async () => {
            if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3500); return; }
            try {
              await client.botDelete(bot.id);
              haptic.notify("warning");
              onChange(bots.filter((b) => b.id !== bot.id));
              onClose();
            } catch { /* noop */ }
          }}
          className={cn("h-11 w-full rounded-[12px] text-[14px] font-semibold transition-colors", armed ? "bg-[#EF4444] text-white" : "border border-[#EF4444]/40 bg-[#EF4444]/10 text-[#DC2626]")}
        >
          {armed ? "Точно удалить? Нажмите ещё раз" : "Удалить бота"}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 font-mono text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{title}</h3>
      <div className="rounded-[16px] border border-border bg-card px-3.5 py-1.5">{children}</div>
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center rounded-full border px-3 font-mono text-[12px] transition-colors",
        on ? "border-[#2563EB] bg-[#2563EB]/10 text-[#2563EB] dark:text-[#3B82F6]" : "border-border text-muted-foreground",
      )}
    >
      {on && <Check size={12} className="mr-1" />}
      {children}
    </button>
  );
}
