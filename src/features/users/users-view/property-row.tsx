import { Badge } from "@/components/ui/badge";

export function PropertyRow({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-muted-foreground">{label}</span>
      {value ? <Badge variant="default">Ja</Badge> : <Badge variant="secondary">Nein</Badge>}
    </div>
  );
}
