/* Настройки: аккаунт, мост (адрес/пара/сброс), вид, о приложении. */

import { useEffect, useState } from "react";
import type { AppClient } from "@/lib/api";
import { APP_VERSION, getTgUser, haptic, type ThemeMode } from "@/lib/tg";
import { cn } from "@/lib/utils";

export interface Settings {
  apiUrl: string;
  theme: ThemeMode;
  haptics: boolean;
}

export function SettingsView({
  client,
  status,
  settings,
  onSettings,
  onConnect,
  onDisconnect,
  onPair,
  onGuide,
}: {
  client: AppClient;
  status: string;
  settings: Settings;
  onSettings: (s: Partial<Settings>) => void;
  onConnect: (url: string) => void;
  onDisconnect: () => void;
  onPair: () => void;
  onGuide: () => void;
}) {
  const [url, setUrl] = useState(settings.apiUrl);
  const [note, setNote] = useState("");
  const [pairing, setPairing] = useState((client as any).pairing || false);
  const u = getTgUser();

  useEffect(() => setUrl(settings.apiUrl), [settings.apiUrl]);
  useEffect(() => setPairing((client as any).pairing || false), [client, status]);

  const statusLabel = { connecting: "подключение…", online: "на связи", offline: "нет связи", demo: "демо" }[status] || status;

  return (
    <div className="space-y-3">
      <header className="px-4 pb-1 pt-1">
        <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Настройки</h1>
      </header>

      <div className="space-y-3 px-4">
        {/* аккаунт */}
        <Card>
          <div className="flex items-center gap-3 py-1.5">
            <div className="grid h-11 w-11 place-items-center rounded-full bg-foreground text-[16px] font-bold text-background">
              {(u?.first_name || "?")[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-[14.5px] font-semibold">{u ? [u.first_name, u.last_name].filter(Boolean).join(" ") : "Гость"}</div>
              <div className="truncate font-mono text-[11.5px] text-muted-foreground">
                {u ? `id: ${u.id}${u.username ? " · @" + u.username : ""}` : "открыто в браузере"}
              </div>
            </div>
          </div>
        </Card>

        {/* мост */}
        <Card>
          <h2 className="py-1 font-mono text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Мост · {statusLabel}</h2>
          <label htmlFor="apiUrl" className="mt-1 block text-[13px] font-medium">Адрес моста</label>
          <input
            id="apiUrl"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://ваш-туннель.example"
            className="mt-1.5 h-11 w-full rounded-[12px] border border-border bg-background px-3 font-mono text-[13px] outline-none placeholder:text-muted-foreground focus:border-foreground/40"
          />
          <p className="mt-1.5 text-[12px] text-muted-foreground">Токен бота остаётся на вашем ПК — в приложении его нет.</p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => onConnect(url)} className="h-11 flex-1 rounded-[12px] bg-foreground text-[14px] font-semibold text-background transition-transform active:scale-[0.97]">Подключить</button>
            <button onClick={() => { onDisconnect(); setUrl(""); setNote("Отключено — вернулись в демо-режим."); }} className="h-11 flex-1 rounded-[12px] border border-border text-[14px] font-semibold transition-transform active:scale-[0.97]">Отключить</button>
          </div>
          {pairing && (
            <button onClick={() => { onPair(); setPairing(false); }} className="mt-2 h-11 w-full rounded-[12px] bg-[#2563EB] text-[14px] font-semibold text-white transition-transform active:scale-[0.97]">
              Закрепить этот аккаунт за мостом
            </button>
          )}
          <button onClick={onGuide} className="mt-2 h-9 w-full rounded-[12px] text-[13px] font-medium text-muted-foreground underline-offset-2 hover:underline">
            Как привязать бота к ZCODE
          </button>
          {note && <p className="mt-1.5 text-[12px] text-muted-foreground">{note}</p>}
        </Card>

        {/* вид */}
        <Card>
          <h2 className="py-1 font-mono text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Внешний вид</h2>
          <label htmlFor="theme" className="mt-1 block text-[13px] font-medium">Тема</label>
          <select
            id="theme"
            value={settings.theme}
            onChange={(e) => { haptic.tap(); onSettings({ theme: e.target.value as ThemeMode }); }}
            className="mt-1.5 h-11 w-full appearance-none rounded-[12px] border border-border bg-background px-3 text-[15px] outline-none focus:border-foreground/40"
          >
            <option value="auto">Как в Telegram</option>
            <option value="light">Светлая</option>
            <option value="dark">Тёмная</option>
          </select>
          <label className="mt-3 flex cursor-pointer items-center justify-between pb-1.5 text-[14px]">
            <span>Виброотклик</span>
            <span className="relative">
              <input
                type="checkbox"
                role="switch"
                checked={settings.haptics}
                onChange={(e) => { haptic.notify(); onSettings({ haptics: e.target.checked }); }}
                className="peer sr-only"
              />
              <span aria-hidden className={cn("block h-[27px] w-[44px] rounded-full border transition-colors", settings.haptics ? "border-[#2563EB] bg-[#2563EB]/15" : "border-border bg-muted")} />
              <span aria-hidden className={cn("pointer-events-none absolute top-[2px] h-[21px] w-[21px] rounded-full transition-all", settings.haptics ? "left-[19px] bg-[#2563EB]" : "left-[2px] bg-muted-foreground")} />
            </span>
          </label>
        </Card>

        <p className="px-1 pb-2 text-center font-mono text-[11px] text-muted-foreground">
          ZCODE Control v{APP_VERSION} · <a className="underline" href="https://github.com/ivan-cruzzz/zcode-control" target="_blank" rel="noopener">исходники</a>
        </p>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-[16px] border border-border bg-card p-4">{children}</section>;
}
