import type { HomeWidget } from "@/lib/home-layout";

export function NoteWidget({
  widget,
  onChange,
}: {
  widget: HomeWidget;
  onChange: (patch: Partial<HomeWidget>) => void;
}) {
  return (
    <textarea
      aria-label="Notiz"
      placeholder="Notiz schreiben…"
      value={widget.text ?? ""}
      onChange={(event) => onChange({ text: event.target.value })}
      className="block h-full w-full resize-none rounded-2xl border bg-card p-4 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-primary"
    />
  );
}
