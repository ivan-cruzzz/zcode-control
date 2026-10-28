/* Консоль команд — kokonutui/ai-prompt (тёмный бокс [S8]-[S12]) +
   лента сообщений с пузырями по miniDESIGN §3.3. */

import { useEffect, useRef } from "react";
import { SquareTerminal } from "lucide-react";
import AI_Prompt, { type PromptCommand } from "@/components/kokonutui/ai-prompt";
import { COMMAND_DEFS, runCommand, type ConsoleMsg, type CommandCtx } from "@/lib/commands";
import { fmtClock } from "@/lib/format";

const SLASH: PromptCommand[] = COMMAND_DEFS.map((c, i) => ({
  id: c.id,
  label: c.label,
  description: c.description,
  icon: <span className="font-mono text-[10px] text-[#8B5CF6]">{String(i + 1).padStart(2, "0")}</span>,
}));

export function Console({
  messages,
  setMessages,
  ctx,
}: {
  messages: ConsoleMsg[];
  setMessages: React.Dispatch<React.SetStateAction<ConsoleMsg[]>>;
  ctx: CommandCtx;
}) {
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function handle(value: string) {
    const text = value.trim();
    if (!text) return;
    const userMsg: ConsoleMsg = { id: `u${Date.now()}`, role: "user", text, time: Date.now() };
    setMessages((m) => [...m.slice(-80), userMsg]);
    const reply = await runCommand(text, ctx);
    if (reply) {
      setMessages((m) => [...m.slice(-80), { id: `a${Date.now()}`, role: "assistant", text: reply, time: Date.now() }]);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2.5 px-4 pb-2 pt-1">
        <SquareTerminal size={20} strokeWidth={2} aria-hidden />
        <h1 className="text-[20px] font-semibold tracking-[-0.02em]">Консоль</h1>
      </header>

      <div ref={feedRef} className="flex-1 space-y-2 overflow-y-auto px-4 pb-3" aria-live="polite">
        {messages.length === 0 && (
          <div className="mt-8 rounded-[16px] border border-border bg-card p-4 text-[13px] text-muted-foreground">
            <p className="font-semibold text-foreground">Пульт ZCODE Control</p>
            <p className="mt-1">Введите «/» — появятся команды. Команды самому ZCODE — в чат бота, это его штатный канал.</p>
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-[16px] rounded-br-[5px] bg-white px-3 py-2 text-[13.5px] whitespace-pre-wrap text-[#111] shadow-[0_8px_30px_rgba(0,0,0,0.18)]">
                {m.text}
                <div className="mt-1 text-right font-mono text-[10px] text-[#9CA3AF]">{fmtClock(m.time)}</div>
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex justify-start">
              <div className="max-w-[88%] whitespace-pre-wrap rounded-[16px] rounded-bl-[5px] border border-[#333] bg-[#2e3033] px-3 py-2 font-mono text-[12.5px] text-[#F3F4F6]">
                {m.text}
                <div className="mt-1 font-sans text-[10px] text-[#9CA3AF]">{fmtClock(m.time)}</div>
              </div>
            </div>
          ),
        )}
      </div>

      <div className="px-3 pb-24 pt-1 safe-bottom">
        <AI_Prompt
          placeholder="Команда пульта… «/» — список"
          headerText=""
          commands={SLASH}
          onSubmit={async (value) => {
            await handle(value);
          }}
        />
      </div>
    </div>
  );
}
