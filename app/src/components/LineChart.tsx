/* Линейный график токенов — miniDESIGN §3.4 / [S14][D4]:
   монохром, ≤4 линии сетки, отрисовка слева-направо ~840ms. */

import { useEffect, useState } from "react";

export type ChartPoint = { date: string; tokens: number };

function fmtK(n: number) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return Math.round(n / 1e3) + "K";
  return String(n);
}

export function LineChart({ data }: { data: ChartPoint[] }) {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDrawn(true), 30);
    return () => clearTimeout(t);
  }, []);

  if (!data.length) return null;
  const W = 320;
  const H = 120;
  const max = Math.max(...data.map((d) => d.tokens), 1);
  const step = W / (data.length - 1 || 1);
  const pts = data.map((d, i) => [i * step, H - 8 - (d.tokens / max) * (H - 24)] as const);
  const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${path} L${W},${H} L0,${H} Z`;

  return (
    <figure role="img" aria-label={`Токены за ${data.length} дней, пик ${fmtK(max)}`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" data-testid="line-chart">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} className="stroke-border/60" strokeWidth={1} strokeDasharray="2 4" />
        ))}
        <path d={area} fill="currentColor" className="text-foreground" opacity={drawn ? 0.05 : 0} style={{ transition: "opacity .8s cubic-bezier(.22,1,.36,1)" }} />
        <path
          d={path}
          fill="none"
          className="stroke-foreground"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: 1000,
            strokeDashoffset: drawn ? 0 : 1000,
            transition: "stroke-dashoffset .84s cubic-bezier(.65,0,.35,1)",
          }}
        />
        {pts.map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={3} className="fill-background stroke-foreground" strokeWidth={1.5} opacity={drawn ? 1 : 0} style={{ transition: `opacity .3s ${0.7 + i * 0.04}s` }} />
            <title>{`${data[i].date}: ${fmtK(data[i].tokens)} токенов`}</title>
          </g>
        ))}
      </svg>
      <figcaption className="mt-1 flex justify-between px-0.5 font-mono text-[10px] text-muted-foreground">
        {data.map((d) => (
          <span key={d.date}>{d.date.slice(8)}</span>
        ))}
      </figcaption>
    </figure>
  );
}
