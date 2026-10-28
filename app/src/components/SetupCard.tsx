/* Чек-лист «Подключение ZCODE» — мастер из v1.3, стили по [S13][S15]. */

import { Check, CircleAlert } from "lucide-react";
import type { SetupState } from "@/lib/api";

function Row({ done, label, hint, action }: { done: boolean; label: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-border/60 py-2.5 last:border-0">
      <span className="mt-0.5">
        {done ? (
          <Check size={18} strokeWidth={2.2} className="text-foreground" aria-label="готово" />
        ) : (
          <CircleAlert size={18} strokeWidth={2} className="text-[#F97316]" aria-label="требуется действие" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold leading-tight">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
      {action}
    </div>
  );
}

export function SetupCard({
  setup,
  onPair,
  onGuide,
}: {
  setup: SetupState | null;
  onPair: () => void;
  onGuide: () => void;
}) {
  if (!setup) return null;
  const { bridge, ownerPaired, bot, billing, tunnel } = setup;
  const allDone = ownerPaired && bridge.dbOk && bot.linkedInZcode && bot.polling && bot.enabledInZcode;

  if (allDone) {
    return (
      <section className="rounded-[16px] border border-foreground/20 bg-foreground/[0.04] p-4">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.06em] text-foreground">Всё подключено</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Команды — в чат <span className="font-mono">@{bot.username}</span>, состояние — здесь.
          {billing?.pro ? " Pro активен." : ` Бесплатный туннель: ${billing?.freeMinutes ?? 60} мин за запуск.`}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[16px] border border-border bg-card p-4">
      <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Подключение ZCODE</h2>
      <div className="mt-1">
        <Row done label="Мост запущен" hint={`режим: ${bridge.mode}`} />
        <Row done={bridge.dbOk} label={bridge.dbOk ? "База ZCODE найдена" : "База ZCODE не найдена"} hint={bridge.dbOk ? "чтение включено" : "запустите мост рядом с ZCODE"} />
        <Row
          done={ownerPaired}
          label={ownerPaired ? "Владелец закреплён" : "Владелец не закреплён"}
          hint={ownerPaired ? "доступ только у вас" : "зафиксируйте мост за своим аккаунтом"}
          action={!ownerPaired ? (
            <button onClick={onPair} className="h-8 shrink-0 rounded-full border border-foreground/40 px-3 text-[13px] font-semibold transition-transform active:scale-95">
              Закрепить
            </button>
          ) : undefined}
        />
        <Row
          done={bot.linkedInZcode}
          label={bot.verified ? `Бот @${bot.username} ${bot.linkedInZcode ? "в ZCode" : "не привязан к ZCode"}` : "Токен бота не настроен"}
          hint={bot.linkedInZcode ? (bot.enabledInZcode ? "привязан и включён" : "включите бота во вкладке Боты") : "одна вставка токена в панели Bots"}
          action={bot.verified && !bot.linkedInZcode ? (
            <button onClick={onGuide} className="h-8 shrink-0 rounded-full bg-foreground px-3 text-[13px] font-semibold text-background transition-transform active:scale-95">
              Привязать
            </button>
          ) : undefined}
        />
        <Row
          done={bot.polling && bot.enabledInZcode}
          label="Поллинг Telegram"
          hint={bot.polling ? "живой канал активен" : bot.linkedInZcode && !bot.enabledInZcode ? "включите тумблером во вкладке Боты" : "включится после привязки"}
        />
        <Row
          done={!!tunnel?.url}
          label={tunnel?.url ? "Туннель поднят" : billing?.pro ? "Pro: туннель по требованию" : `Туннель не поднят (лимит ${billing?.freeMinutes ?? 60} мин)`}
          hint={billing?.pro ? "Pro: без лимита времени" : "оформление — /sub в чате бота"}
        />
      </div>
    </section>
  );
}
