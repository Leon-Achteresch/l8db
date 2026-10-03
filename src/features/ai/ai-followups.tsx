import { ArrowRight, CornerDownRight } from "lucide-react";

export function AiFollowups({
  questions,
  onAsk,
}: {
  questions: string[];
  onAsk: (question: string) => void;
}) {
  if (!questions.length) return null;
  return (
    <section
      className="mt-4 divide-y overflow-hidden rounded-xl border bg-card"
      aria-label="Mögliche nächste Fragen"
    >
      {questions.map((question) => (
        <button
          key={question}
          type="button"
          onClick={() => onAsk(question)}
          className="group/followup flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-foreground/85 outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">{question}</span>
          <ArrowRight className="size-3.5 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-[opacity,transform] duration-200 group-hover/followup:translate-x-0 group-hover/followup:opacity-100 group-focus-visible/followup:opacity-100" />
        </button>
      ))}
    </section>
  );
}
