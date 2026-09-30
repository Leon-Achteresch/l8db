import { PlusIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ReleaseCheck } from "@/lib/versioning/types";
import { VersioningIconButton } from "./versioning-icon-button";

export function VersioningCheckEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ReleaseCheck[];
  onChange: (value: ReleaseCheck[]) => void;
}) {
  const update = (id: string, field: "title" | "sql" | "expected", text: string) =>
    onChange(value.map((check) => (check.id === id ? { ...check, [field]: text } : check)));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium">{label}</h4>
        <VersioningIconButton
          icon={PlusIcon}
          label={`${label} hinzufügen`}
          onClick={() =>
            onChange([
              ...value,
              {
                id: crypto.randomUUID(),
                title: `${label} ${value.length + 1}`,
                sql: "",
                expected: "0",
                checksum: "",
              },
            ])
          }
        />
      </div>
      {value.map((check, index) => (
        <div key={check.id} className="space-y-2 rounded-lg bg-muted/25 p-3">
          <div className="flex gap-2">
            <Input
              aria-label={`${label} ${index + 1}: Name`}
              value={check.title}
              onChange={(event) => update(check.id, "title", event.target.value)}
            />
            <VersioningIconButton
              icon={XIcon}
              label={`${label} ${index + 1} entfernen`}
              onClick={() => onChange(value.filter((item) => item.id !== check.id))}
            />
          </div>
          <Textarea
            aria-label={`${label} ${index + 1}: SQL`}
            className="min-h-24 resize-y font-mono text-xs"
            placeholder="SELECT COUNT(*) FROM … WHERE …"
            value={check.sql}
            onChange={(event) => update(check.id, "sql", event.target.value)}
          />
          <Input
            aria-label={`${label} ${index + 1}: Erwartetes Ergebnis`}
            placeholder="Erwartetes Ergebnis"
            value={check.expected}
            onChange={(event) => update(check.id, "expected", event.target.value)}
          />
        </div>
      ))}
    </div>
  );
}
