/* Обзор: статус, метрики (S13), график (S14), активность, мастер подключения. */

import { useEffect, useState } from "react";
import { LineChart, type ChartPoint } from "@/components/LineChart";
import { SetupCard } from "@/components/SetupCard";
import type { AppClient, ClientStatus, SetupState } from "@/lib/api";
import { fmtTokens, fmtRel, fmtDir } from "@/lib/format";

type Overview = {
  status: { state: string; model: string | null; mode: string | null; updatedAt: number | null; session: { id: string; title: string } | null };
  stats: { sessions: number; sessionsToday: number; tokensToday: number; todosActive: number };
  activity: { sessionId: string; sessionTitle: string; time: number; text: string }[];
};

export function Overview({
  client,
  setup,
  refreshTick,
  onPair,
  onGuide,
  onOpenSession,
}: {
  client: AppClient;
  status?: ClientStatus;
  setup: SetupState | null;
  refreshTick: number;
  onPair: () => void;
  onGuide: () => void;
  onOpenSession: (id: string) => void;
}) {
  const [data, setData] = useState<Overview | null>(null);
  const [chart, setChart] = useState<ChartPoint[]>([]);

  useEffect(() => {
    let dead = false;
    client.overview().then((d: any) => !dead && setData(d)).catch(() => {});
    client.stats(7).then((d: any) => !dead && setChart(d.daily || [])).catch(() => {});
    return () => { dead = true; };
  }, [client, refreshTick]);

  const st = data?.status;
  const stateLabel = { active: "ZCODE активен", idle: "простаивает", offline: "нет данных" }[st?.state || "offline"] || "нет данных";
  const live = st?.state === "active";

  return (
    <div className="space-y-3">
      <SetupCard setup={setup} onPair={onPair} onGuide={onGuide} />

      {/* статус */}
      <section className="relative overflow-hidden rounded-[16px] border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${live ? "bg-[#22C55E] animate-pulse" : st?.state === "idle" ? "bg-[#F97316]" : "bg-muted-foreground"}`} />
          <span className="font-mono text-[12px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{stateLabel}</span>
          {st?.model && <span className="ml-auto rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">{st.model}</span>}
          {st?.mode && <span className="rounded-full border border-[#8B5CF6]/40 bg-[#8B5CF6]/10 px-2 py-0.5 font-mono text-[11px] text-[#8B5CF6]">{st.mode}</span>}
        </div>
        <h2 className="mt-2 line-clamp-2 text-[17px] font-semibold leading-snug tracking-[-0.02em]">
          {st?.session?.title || "Нет активных сессий"}
        </h2>
        {st?.updatedAt && <p className="mt-1 font-mono text-[12px] text-muted-foreground">обновлён {fmtRel(st.updatedAt)}</p>}
      </section>

      {/* метрики [S13] */}
      <div className="grid grid-cols-2 gap-3">
        <Metric value={fmtTokens(data?.stats.tokensToday)} label="токенов сегодня" accent />
        <Metric value={String(data?.stats.sessions ?? "—")} label="сессий всего" />
        <Metric value={String(data?.stats.todosActive ?? 0)} label="задач в работе" />
        <Metric value={String(data?.stats.sessionsToday ?? 0)} label="сессий сегодня" />
      </div>

      {/* график [S14] */}
      {chart.length > 0 && (
        <section className="rounded-[16px] border border-border bg-card p-4">
          <h3 className="mb-2 font-mono text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Токены · 7 дней</h3>
          <LineChart data={chart} />
        </section>
      )}

      {/* активность */}
      <section>
        <h3 className="mb-2 mt-4 font-mono text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Последняя активность</h3>
        <div className="space-y-2">
          {(data?.activity || []).map((a) => (
            <button
              key={a.sessionId + a.time}
              onClick={() => onOpenSession(a.sessionId)}
              className="w-full rounded-[16px] border border-border bg-card p-3 text-left transition-transform active:scale-[0.98]"
            >
              <div className="line-clamp-2 text-[13.5px]">{a.text}</div>
              <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                {fmtDir(a.sessionTitle)} · {fmtRel(a.time)}
              </div>
            </button>
          ))}
          {data && !data.activity.length && <p className="rounded-[16px] border border-border bg-card p-4 text-center text-[13px] text-muted-foreground">Пока тихо.</p>}
        </div>
      </section>
    </div>
  );
}

function Metric({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="rounded-[16px] border border-border bg-card p-3.5">
      <div className={`font-mono text-[26px] font-semibold leading-none tracking-[-0.02em] ${accent ? "text-[#2563EB] dark:text-[#3B82F6]" : ""}`}>
        {value}
      </div>
      <div className="mt-1.5 text-[12.5px] text-muted-foreground">{label}</div>
    </div>
  );
}
