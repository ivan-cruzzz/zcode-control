/* ZCODE Control v2 — корневой компонент: состояние, навигация, подключение. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Dock, type ViewId } from "@/components/Dock";
import { Overview } from "@/views/Overview";
import { Sessions } from "@/views/Sessions";
import { Console } from "@/views/Console";
import { Bots } from "@/views/Bots";
import { SettingsView, type Settings } from "@/views/SettingsView";
import { BridgeClient, DemoClient, type AppClient, type ClientStatus, type SetupState } from "@/lib/api";
import { applyTheme, getInitData, haptic, initTg, setHapticsEnabled, tg, APP_VERSION } from "@/lib/tg";
import type { ConsoleMsg } from "@/lib/commands";

const REPO_URL = "https://github.com/ivan-cruzzz/zcode-control";
const SETTINGS_KEY = "zcode.settings.v2";

function loadSettings(): Settings {
  try {
    return { apiUrl: "", theme: "auto", haptics: true, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { apiUrl: "", theme: "auto", haptics: true };
  }
}

export default function App() {
  const [view, setView] = useState<ViewId>("overview");
  const [status, setStatus] = useState<ClientStatus>("connecting");
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [refreshTick, setRefreshTick] = useState(0);
  const [focusSession, setFocusSession] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [consoleMsgs, setConsoleMsgs] = useState<ConsoleMsg[]>([]);
  const clientRef = useRef<AppClient | null>(null);

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  const loadSetup = useCallback((client: AppClient) => {
    client.setup().then((s: any) => setSetup(s)).catch(() => {});
  }, []);

  // старт
  useEffect(() => {
    initTg();
    const s = loadSettings();
    setSettings(s);
    applyTheme(s.theme);
    setHapticsEnabled(s.haptics);

    // глубокая ссылка из Telegram: t.me/<bot>?startapp=<base64url(адрес моста)> —
    // мост присылает такую кнопку при каждом подъёме туннеля, адрес всегда свежий
    let tunnelNote: string | null = null;
    try {
      const sp = (tg as any)?.initDataUnsafe?.start_param;
      if (sp) {
        const decoded = atob(sp.replace(/-/g, "+").replace(/_/g, "/"));
        if (/^https:\/\//i.test(decoded) && decoded !== s.apiUrl) {
          s.apiUrl = decoded;
          patchSettings({ apiUrl: decoded });
          tunnelNote = decoded;
        }
      }
    } catch { /* битый start_param — игнорируем */ }
    if (tunnelNote) {
      setConsoleMsgs([{
        id: "boot",
        role: "assistant",
        text: `Подключено по ссылке из Telegram:\n${tunnelNote}`,
        time: Date.now(),
      }]);
    }

    const handlers = {
      onStatus: (st: ClientStatus) => setStatus(st),
      onEvent: (e: { type: string; scope?: string }) => {
        if (e.type !== "refresh") return;
        setRefreshTick((x) => x + 1);
        if (clientRef.current) loadSetup(clientRef.current);
      },
    };

    let client: AppClient;
    if (s.apiUrl.trim()) {
      const c = new BridgeClient(handlers);
      c.setUrl(s.apiUrl);
      client = c;
      setIsDemo(false);
    } else {
      client = new DemoClient(handlers);
      setIsDemo(true);
    }
    clientRef.current = client;
    client.connect(getInitData()).then(() => loadSetup(client)).catch(() => {});

    const onThemeChanged = () => applyTheme(s.theme);
    tg?.onEvent?.("themeChanged", onThemeChanged);
    const onVisible = () => {
      if (!document.hidden && client.status === "offline" && typeof (client as any).reconnectNow === "function") {
        (client as any).reconnectNow();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      client.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => applyTheme(settings.theme), [settings.theme]);

  const navigate = useCallback((v: ViewId) => {
    setView(v);
    window.scrollTo({ top: 0 });
  }, []);

  const connectTo = useCallback((url: string) => {
    if (!url.trim()) return;
    patchSettings({ apiUrl: url });
    window.location.reload();
  }, [patchSettings]);

  const disconnect = useCallback(() => {
    patchSettings({ apiUrl: "" });
    window.location.reload();
  }, [patchSettings]);

  const pair = useCallback(async () => {
    const c = clientRef.current;
    if (!c) return;
    try {
      await c.pair();
      haptic.notify();
      loadSetup(c);
      setRefreshTick((x) => x + 1);
    } catch (e) {
      alert((e as Error).message);
    }
  }, [loadSetup]);

  const openSession = useCallback((id: string) => {
    setFocusSession(id);
    navigate("sessions");
    setTimeout(() => setFocusSession(null), 400);
  }, [navigate]);

  const client = clientRef.current!;
  const commandCtx = useMemo(
    () => ({
      client,
      status,
      goto: navigate,
      setTheme: (m: any) => patchSettings({ theme: m }),
      clear: () => setConsoleMsgs([]),
    }),
    [client, status, navigate, patchSettings],
  );

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="safe-top sticky top-0 z-40 border-b border-border bg-background/85 px-4 pb-2.5 pt-3 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div aria-hidden className="grid h-7 w-7 place-items-center rounded-[8px] bg-foreground font-mono text-[12px] font-bold text-background">
              ▸_
            </div>
            <div className="text-[14px] text-muted-foreground">
              <span className="font-mono font-bold tracking-[0.04em] text-foreground">ZCODE</span> Control
            </div>
          </div>
          <div
            className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-mono text-[11px] text-muted-foreground"
            role="status"
            aria-label={`Соединение: ${status}`}
          >
            <span aria-hidden className={
              "h-1.5 w-1.5 rounded-full " +
              (status === "online" ? "bg-[#22C55E]" : status === "connecting" ? "bg-[#F97316] animate-pulse" : status === "demo" ? "bg-[#8B5CF6]" : "bg-[#EF4444]")
            } />
            {status === "online" ? "на связи" : status === "connecting" ? "…" : status === "demo" ? "демо" : "нет связи"}
          </div>
        </div>
      </header>

      <main className="mx-auto min-h-[calc(100dvh-140px)] max-w-md px-4 pb-28 pt-3">
        {status === "connecting" ? (
          <p className="mt-16 text-center font-mono text-[13px] text-muted-foreground">подключение…</p>
        ) : view === "overview" ? (
          <Overview client={client} setup={setup} refreshTick={refreshTick} onPair={pair} onGuide={() => setGuideOpen(true)} onOpenSession={openSession} />
        ) : view === "sessions" ? (
          <Sessions client={client} refreshTick={refreshTick} focusSession={focusSession} />
        ) : view === "console" ? (
          <Console messages={consoleMsgs} setMessages={setConsoleMsgs} ctx={commandCtx} />
        ) : view === "bots" ? (
          <Bots client={client} refreshTick={refreshTick} />
        ) : (
          <SettingsView
            client={client}
            status={status}
            settings={settings}
            onSettings={patchSettings}
            onConnect={connectTo}
            onDisconnect={disconnect}
            onPair={pair}
            onGuide={() => setGuideOpen(true)}
          />
        )}
      </main>

      <Dock view={view} onNavigate={navigate} />

      {guideOpen && <GuideSheet onClose={() => setGuideOpen(false)} bot={setup?.bot ?? null} />}
    </div>
  );
}

function GuideSheet({ onClose, bot }: { onClose: () => void; bot: SetupState["bot"] | null }) {
  useEffect(() => {
    tg?.BackButton?.show?.();
    const h = () => onClose();
    tg?.BackButton?.onClick?.(h);
    return () => { tg?.BackButton?.offClick?.(h); tg?.BackButton?.hide?.(); };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background" role="dialog" aria-label="Привязка бота к ZCODE">
      <header className="flex items-center gap-3 border-b border-border px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
        <button onClick={onClose} aria-label="Назад" className="grid h-10 w-10 place-items-center rounded-[12px] border border-border transition-transform active:scale-90">
          <X size={18} />
        </button>
        <div className="flex-1 text-[14px] font-semibold">Привязать бота к ZCODE</div>
      </header>
      <div className="space-y-3 overflow-y-auto p-4">
        <section className="rounded-[16px] border border-border bg-card p-4 text-[13px] text-muted-foreground">
          После привязки ZCode сам принимает сообщения бота: пишете команду в чат — ZCODE выполняет её на компьютере. Мини-апп показывает сессии и управляет настройками.
        </section>
        <section className="space-y-2 rounded-[16px] border border-border bg-card p-4 text-[13.5px]">
          <p><b>1.</b> Откройте ZCode на ПК → панель <b>Bots</b> → <b>New bot</b>.</p>
          <p><b>2.</b> Токен: в Telegram у <b>@BotFather</b> → <code className="rounded bg-muted px-1 font-mono text-[12px]">/mybots</code> → ваш бот → <b>API Token</b>.</p>
          <p><b>3.</b> Вставьте токен в ZCode и включите — появится «Telegram long polling is running».</p>
          <p><b>4.</b> Нажмите «Проверить снова» на Обзоре — галочка станет зелёной.</p>
        </section>
        <button onClick={onClose} className="h-11 w-full rounded-[12px] bg-foreground text-[14px] font-semibold text-background transition-transform active:scale-[0.97]">
          Понятно
        </button>
        <p className="text-center font-mono text-[11px] text-muted-foreground">
          {bot?.username ? `@${bot.username}` : ""} · v{APP_VERSION} · <a className="underline" href={REPO_URL} target="_blank" rel="noopener">repo</a>
        </p>
      </div>
    </div>
  );
}
