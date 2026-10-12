import { ArrowRight, CornerDownRight } from "lucide-react";
import { GlideMenu } from "@/components/primitives/glide-menu";

export function AiFollowups({
  questions,
  onAsk,
}: {
  questions: string[];
  onAsk: (question: string) => void;
}) {
  if (!questions.length) return null;
  return (
    <section className="mt-4" aria-label="Mögliche nächste Fragen">
      <GlideMenu className="-mx-1.5 flex flex-col gap-px">
        {questions.map((question) => (
          <button
            key={question}
            type="button"
            data-menu-row
            onClick={() => onAsk(question)}
            className="group/followup relative flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left text-[13px] text-foreground/80 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">{question}</span>
            <ArrowRight className="size-3.5 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-[opacity,transform] duration-200 group-hover/followup:translate-x-0 group-hover/followup:opacity-100 group-focus-visible/followup:translate-x-0 group-focus-visible/followup:opacity-100" />
          </button>
        ))}
      </GlideMenu>
    </section>
  );
}
