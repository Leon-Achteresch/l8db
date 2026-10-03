const STARTERS = [
  "Erkläre mir das Schema",
  "Welche Tabellen sind am größten?",
  "Welche Indizes fehlen?",
  "Schreibe eine Abfrage, die ",
];

export function AiStarters({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="mt-3 flex flex-wrap justify-center gap-1.5">
      {STARTERS.map((text) => (
        <button
          key={text}
          type="button"
          onClick={() => onPick(text)}
          className="rounded-full border px-3 py-1 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {text.trim()}
        </button>
      ))}
    </div>
  );
}
