/* Мост к Telegram WebApp с безопасными фолбэками (браузер тоже должен работать).
   Тема — по миниDESIGN: светлая по умолчанию, тёмная по themeParams. */

export type ThemeMode = "auto" | "light" | "dark";

type TgUser = { id: number; first_name?: string; last_name?: string; username?: string };

const tg = (window as any).Telegram?.WebApp ?? null;

/** Сырой Telegram WebApp (может быть null в браузере). */
export { tg };

let hapticsEnabled = true;
export function setHapticsEnabled(v: boolean) {
  hapticsEnabled = v;
}

export const APP_VERSION = "2.0.0";

export function initTg() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.enableClosingConfirmation?.();
    tg.disableVerticalSwipes?.();
  } catch {
    /* старые клиенты */
  }
}

function luminance(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  const p = tg?.themeParams ?? {};
  const isLight =
    mode === "light" ||
    (mode === "auto" && (!p.bg_color || luminance(p.bg_color) > 0.6));
  root.classList.toggle("dark", !isLight);

  const r = root.style;
  if (!isLight && p.bg_color) {
    r.setProperty("--tg-bg", p.bg_color);
    r.setProperty("--tg-bg-2", p.secondary_bg_color || p.section_bg_color || "");
    r.setProperty("--tg-text", p.text_color || "");
    r.setProperty("--tg-text-2", p.hint_color || "");
  } else {
    ["--tg-bg", "--tg-bg-2", "--tg-text", "--tg-text-2"].forEach((k) => r.removeProperty(k));
  }
  try { tg?.setHeaderColor?.("bg_color"); } catch { /* noop */ }
}

export const haptic = {
  tap() { if (hapticsEnabled) tg?.HapticFeedback?.selectionChanged?.(); },
  impact(kind = "light") { if (hapticsEnabled) tg?.HapticFeedback?.impactOccurred?.(kind); },
  notify(type = "success") { if (hapticsEnabled) tg?.HapticFeedback?.notificationOccurred?.(type); },
};

export function getInitData(): string {
  return tg?.initData || "";
}

export function getTgUser(): TgUser | null {
  const raw = new URLSearchParams(tg?.initData || "").get("user");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function isTelegram(): boolean {
  return !!tg?.initData;
}
