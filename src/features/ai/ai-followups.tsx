export function AiFollowups({
  questions,
  onAsk,
}: {
  questions: string[];
  onAsk: (question: string) => void;
}) {
  if (!questions.length) return null;
  return (
    <section className="mt-4 flex flex-wrap gap-1.5" aria-label="Mögliche nächste Fragen">
      {questions.map((question) => (
        <button
          key={question}
          type="button"
          onClick={() => onAsk(question)}
          className="rounded-2xl bg-muted/70 px-3 py-1.5 text-left text-[12.5px] leading-snug text-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {question}
        </button>
      ))}
    </section>
  );
}
