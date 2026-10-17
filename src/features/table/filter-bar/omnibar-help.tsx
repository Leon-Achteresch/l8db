import { Kbd } from "@/components/ui/kbd";
import { IS_MAC } from "@/lib/platform";

const ROWS = [
  { keys: "↵", text: "Filter hinzufügen", example: "status = 'error'" },
  { keys: "⇧↵", text: "Passende Zeilen farbig markieren", example: "tokens > 4000" },
  {
    keys: IS_MAC ? "⌘↵" : "Strg+↵",
    text: "In eigenen Worten die KI fragen",
    example: "nur Fehler der letzten Woche",
  },
];

export function OmnibarHelp() {
  return (
    <div className="grid gap-1.5 p-1.5 text-xs">
      {ROWS.map((row) => (
        <div key={row.keys} className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-baseline gap-2">
          <Kbd className="justify-self-start">{row.keys}</Kbd>
          <span className="min-w-0">
            {row.text}
            <span className="ml-1.5 font-mono text-muted-foreground">{row.example}</span>
          </span>
        </div>
      ))}
      <p className="pt-1 text-[11px] text-muted-foreground">
        Weitere Beispiele: name LIKE '%max%' · id IN (1, 2) · note IS NULL. Die KI sieht
        Spaltennamen, -typen, deine Anfrage und die aktiven Filter, aber keine Tabellenzeilen.
      </p>
    </div>
  );
}
