/* Форматтеры — моно-цифры по miniDESIGN [S2][S13]. */

export function fmtTokens(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + "k";
  return String(n);
}

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export function fmtRel(ms: number | null | undefined) {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "только что";
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + " мин";
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + " ч";
  if (diff < 2 * 86_400_000) return "вчера";
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function fmtDir(path?: string | null) {
  if (!path) return "";
  const parts = String(path).replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

export function fmtClock(ms: number) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
