/* Сессии: список, фильтр + полнотекстовый поиск, карточка сессии (шторка). */

import { useEffect, useRef, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import type { AppClient, SessionItem } from "@/lib/api";
import { fmtTokens, fmtRel, fmtDir } from "@/lib/format";
import { haptic, tg } from "@/lib/tg";
import { cn } from "@/lib/utils";

const ACTIVE_WINDOW = 5 * 60_000;

export function Sessions({ client, refreshTick, focusSession, botUsername }: { client: AppClient; refreshTick: number; focusSession: string | null; botUsername: string }) {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [filter, setFilter] = useState("");
  const [global, setGlobal] = useState<{ title: string; items: any[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    client.sessions(40).then((d: any) => setSessions(d.sessions || [])).catch(() => {});
  }, [client, refreshTick]);

  useEffect(() => {
    if (focusSession) setOpen(focusSession);
  }, [focusSession]);

  // глобальный поиск с дебаунсом (≥3 символов)
  useEffect(() => {
    const q = filter.trim();
    if (q.length < 3) { setGlobal(null); return; }
    const t = setTimeout(() => {
      client.search(q).then((d: any) => setGlobal({ title: `Сообщения · ${d.results.length}`, items: d.results })).catch(() => {});
    }, 450);
    return () => clearTimeout(t);
  }, [filter, client]);

  const q = filter.trim().toLowerCase();
  const list = sessions.filter((s) => !q || s.title?.toLowerCase().includes(q) || s.directory?.toLowerCase().includes(q));

  return (
    <div>
      <header className="flex items-center gap-2.5 px-4 pb-2 pt-1">
        <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Сессии</h1>
        <span className="ml-auto font-mono text-[12px] text-muted-foreground">{sessions.length}</span>
      </header>

      <div className="px-4">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          type="search"
          placeholder="Фильтр и поиск…"
          aria-label="Фильтр и поиск"
          className="h-11 w-full rounded-[12px] border border-border bg-card px-3.5 text-[15px] outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/40"
        />
      </div>

      <div className="space-y-2 px-4 pt-3">
        {list.map((s) => {
          const live = Date.now() - s.timeUpdated < ACTIVE_WINDOW;
          return (
            <button
              key={s.id}
              onClick={() => { haptic.impact(); setOpen(s.id); }}
              className="flex w-full items-center gap-3 rounded-[16px] border border-border bg-card p-3.5 text-left transition-transform active:scale-[0.98]"
            >
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-[14px] font-semibold leading-snug">{s.title || "(без названия)"}</div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                  {live && <span className="rounded-full border border-[#22C55E]/40 bg-[#22C55E]/10 px-1.5 text-[10px] font-bold text-[#16A34A]">live</span>}
                  {!live && s.outcome === "completed" && <span className="rounded-full border border-border px-1.5 text-[10px]">готово</span>}
                  {!live && s.outcome === "interrupted" && <span className="rounded-full border border-[#F97316]/40 bg-[#F97316]/10 px-1.5 text-[10px] text-[#C2410C]">прервана</span>}
                  <span className="truncate">{fmtDir(s.directory)}</span>
                  <span>{fmtTokens(s.tokens)}</span>
                  <span>{fmtRel(s.timeUpdated)}</span>
                </div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
            </button>
          );
        })}
        {!sessions.length && <p className="rounded-[16px] border border-border bg-card p-4 text-center text-[13px] text-muted-foreground">Сессий пока нет.</p>}
        {sessions.length > 0 && !list.length && <p className="rounded-[16px] border border-border bg-card p-4 text-center text-[13px] text-muted-foreground">Ничего не найдено.</p>}
      </div>

      {global && (
        <div className="px-4 pt-4">
          <h3 className="mb-2 font-mono text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{global.title}</h3>
          <div className="space-y-2">
            {global.items.map((r, i) => (
              <button key={i} onClick={() => setOpen(r.sessionId)} className="w-full rounded-[16px] border border-border bg-card p-3 text-left transition-transform active:scale-[0.98]">
                <div className="mb-1 truncate font-mono text-[11px] text-muted-foreground">{r.sessionTitle} · {fmtRel(r.time)}</div>
                <div className="text-[13.5px]">…{r.text}…</div>
              </button>
            ))}
            {!global.items.length && <p className="rounded-[16px] border border-border bg-card p-3 text-center text-[13px] text-muted-foreground">В сообщениях пусто.</p>}
          </div>
        </div>
      )}

      {open && <SessionSheet id={open} client={client} botUsername={botUsername} onClose={() => setOpen(null)} />}
    </div>
  );
}

function SessionSheet({ id, client, botUsername, onClose }: { id: string; client: AppClient; botUsername: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [outgoing, setOutgoing] = useState<any[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    client.sessionDetail(id).then(setData).catch(() => {});
  }, [id, client]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [data, outgoing]);

  useEffect(() => {
    tg?.BackButton?.show?.();
    const handler = () => onClose();
    tg?.BackButton?.onClick?.(handler);
    return () => {
      tg?.BackButton?.offClick?.(handler);
      tg?.BackButton?.hide?.();
    };
  }, [onClose]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setErr(null);
    setHint(null);
    try {
      // Полная автоматизация: мост отправляет текст в чат бота от вашего имени
      // (MTProto) — ZCode получает его как обычное сообщение. Ответ прилетит в диалог.
      const res = await client.sessionSend(id, text);
      if ((res as any).needUserLogin) {
        setErr("Разовая настройка: на ПК в папке server выполните «npm run user» и войдите в Telegram. После этого сообщения будут уходить отсюда автоматически.");
        haptic.notify("error");
        return;
      }
      setOutgoing((o) => [...o, { id: `out${Date.now()}`, role: "user", time: Date.now(), text, queued: false }]);
      setDraft("");
      haptic.notify();
      setHint("Отправлено ZCODE — ответ появится в диалоге автоматически.");
    } catch (e: any) {
      setErr(e.message);
      haptic.notify("error");
    } finally {
      setSending(false);
    }
  }

  const s = data?.session;
  const messages = [...(data?.messages || []), ...outgoing];

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background" role="dialog" aria-label="Чат сессии">
      <header className="flex items-center gap-3 border-b border-border px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
        <button onClick={onClose} aria-label="Назад" className="grid h-10 w-10 place-items-center rounded-[12px] border border-border transition-transform active:scale-90">
          <X size={18} />
        </button>
        <div className="min-w-0 flex-1 truncate text-[14px] font-semibold">{s?.title || "…"}</div>
      </header>

      <div ref={feedRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {!data && <p className="text-center text-[13px] text-muted-foreground">Загрузка…</p>}
        {s && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Kv v={fmtTokens(s.tokens)} l="токенов" />
              <Kv v={<><span className="text-[#16A34A]">+{s.additions ?? 0}</span> <span className="text-[#DC2626]">−{s.deletions ?? 0}</span></>} l="строк" />
              <Kv v={`${(data.todos || []).filter((t: any) => t.status === "completed").length}/${(data.todos || []).length}`} l="задач" />
            </div>

            {!!data.todos?.length && (
              <>
                <h3 className="font-mono text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Задачи</h3>
                <div className="rounded-[16px] border border-border bg-card p-3">
                  {data.todos.map((t: any, i: number) => (
                    <div key={i} className={cn("flex gap-2.5 border-b border-border/60 py-2 text-[13.5px] last:border-0", t.status === "completed" && "text-muted-foreground line-through", t.status === "in_progress" && "font-semibold")}>
                      <span aria-hidden>{t.status === "completed" ? "✓" : t.status === "in_progress" ? "◔" : "○"}</span>
                      <span className="flex-1">{t.content}</span>
                      <span className="font-mono text-[10px] uppercase text-muted-foreground">{t.priority}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <h3 className="font-mono text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Диалог</h3>
            <div>
              {messages.map((m: any) => (
                <div key={m.id} className={cn("mb-2 max-w-[88%] rounded-[14px] px-3 py-2 text-[13.5px] whitespace-pre-wrap", m.role === "user" ? "ml-auto rounded-br-[5px] bg-foreground text-background" : "mr-auto rounded-bl-[5px] border border-border bg-card")}>
                  {(m.text || "").slice(0, 1200)}
                  <div className={cn("mt-1 font-mono text-[10px]", m.role === "user" ? "text-background/60" : "text-muted-foreground")}>
                    {m.queued ? "в очереди ввода · " : ""}{fmtRel(m.time)}
                  </div>
                </div>
              ))}
            </div>

            {!!data.tools?.length && (
              <>
                <h3 className="font-mono text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Инструменты</h3>
                <div className="rounded-[16px] border border-border bg-card p-3">
                  {data.tools.map((t: any, i: number) => (
                    <div key={i} className="flex border-b border-border/60 py-2 font-mono text-[12.5px] last:border-0">
                      <span className="flex-1">{t.name}</span>
                      <span className="text-muted-foreground">{t.count} · ~{t.avgMs} мс</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* ввод внизу, как в мессенджере */}
      <div className="border-t border-border px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2">
        {err && (
          <div className="mb-2 rounded-[12px] border border-[#EF4444]/40 bg-[#EF4444]/10 p-2.5 text-[12px] text-[#DC2626]">{err}</div>
        )}
        {hint && (
          <div className="mb-2 rounded-[12px] border border-[#2563EB]/40 bg-[#2563EB]/10 p-2.5 text-[12px] text-[#2563EB] dark:text-[#3B82F6]">{hint}</div>
        )}
        <div className="flex items-end gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            placeholder="Текст для ZCODE…"
            aria-label="Сообщение в сессию"
            className="h-11 min-w-0 flex-1 rounded-[9999px] border border-border bg-card px-4 text-[15px] outline-none placeholder:text-muted-foreground focus:border-foreground/40"
          />
          <button
            onClick={send}
            disabled={sending || !draft.trim()}
            aria-label="Отправить"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-foreground text-background transition-transform active:scale-90 disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
          </button>
        </div>
        <p className="mt-1.5 text-center text-[10.5px] leading-snug text-muted-foreground">
          Экспериментально: текст ставится в очередь ввода сессии. Надёжный канал — чат бота.
        </p>
      </div>
    </div>
  );
}

function Kv({ v, l }: { v: React.ReactNode; l: string }) {
  return (
    <div className="rounded-[12px] border border-border bg-card p-2.5 text-center">
      <b className="block font-mono text-[15px]">{v}</b>
      <span className="text-[11px] text-muted-foreground">{l}</span>
    </div>
  );
}
