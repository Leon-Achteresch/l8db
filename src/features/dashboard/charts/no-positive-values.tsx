export function NoPositiveValues({ negative }: { negative: number }) {
  return (
    <div className="grid h-full w-full place-items-center p-3 text-center text-xs text-muted-foreground">
      {negative > 0
        ? `Keine positiven Werte. ${negative} negative Werte lassen sich nicht als Anteil zeigen.`
        : "Keine positiven Werte."}
    </div>
  );
}
