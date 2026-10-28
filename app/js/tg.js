/* Обёртка над Telegram WebApp API с безопасными фолбэками
   (приложение должно корректно открываться и в обычном браузере). */

export const tg = window.Telegram?.WebApp ?? null;
export const APP_VERSION = "1.3.0";

let hapticsEnabled = true;

export function setHapticsEnabled(v) {
  hapticsEnabled = !!v;
}

export function initTg() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.enableClosingConfirmation?.();
    tg.disableVerticalSwipes?.();
    tg.setHeaderColor?.("bg_color");
    tg.setBackgroundColor?.("bg_color");
  } catch {
    /* старые клиенты — не критично */
  }
}

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Применяет тему: 'auto' — следовать themeParams Telegram, иначе форсировать. */
export function applyTheme(mode = "auto") {
  const root = document.documentElement;
  const p = tg?.themeParams ?? {};

  if (mode === "light") {
    root.dataset.theme = "light";
  } else {
    delete root.dataset.theme;
  }

  const vars = {
    "--bg": p.bg_color,
    "--bg-2": p.secondary_bg_color || p.section_bg_color,
    "--text": p.text_color,
    "--text-2": p.hint_color,
    "--link": p.link_color,
    "--btn": p.button_color,
    "--btn-text": p.button_text_color,
  };

  if (mode !== "light") {
    for (const [k, v] of Object.entries(vars)) {
      if (v) root.style.setProperty(k, v);
    }
    // Светлые themeParams в режиме auto — переключаем светлый набор токенов
    if (mode === "auto" && p.bg_color && luminance(p.bg_color) > 0.6) {
      root.dataset.theme = "light";
      for (const k of Object.keys(vars)) root.style.removeProperty(k);
    }
  } else {
    for (const k of Object.keys(vars)) root.style.removeProperty(k);
  }
}

export const haptic = {
  tap() { if (hapticsEnabled) tg?.HapticFeedback?.selectionChanged?.(); },
  impact(kind = "light") { if (hapticsEnabled) tg?.HapticFeedback?.impactOccurred?.(kind); },
  notify(type = "success") { if (hapticsEnabled) tg?.HapticFeedback?.notificationOccurred?.(type); },
};

export function getInitData() {
  return tg?.initData || "";
}

export function getTgUser() {
  const raw = new URLSearchParams(tg?.initData || "").get("user");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
