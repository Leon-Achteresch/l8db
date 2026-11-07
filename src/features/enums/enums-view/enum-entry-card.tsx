import { PlusIcon, Trash2Icon } from "lucide-react";
import { motion } from "motion/react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useActiveConnection } from "@/lib/connections";
import { executeQuery } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { SPRING_LAYOUT } from "@/lib/ease";
import { addEnumValueSql, renameEnumValueSql } from "@/lib/enum-ddl";
import { effectiveConnectionString } from "@/lib/ssh";

export function EnumEntryCard({
  entry,
  onChanged,
  onDrop,
}: {
  entry: { schema: string; name: string; values: string[] };
  onChanged: () => void;
  onDrop: () => void;
}) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const value = text.trim();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!connection || !value) return;
    setSaving(true);
    try {
      await executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        renaming === null
          ? addEnumValueSql(entry.schema, entry.name, value)
          : renameEnumValueSql(entry.schema, entry.name, renaming, value),
        database ?? undefined,
      );
      toast.success(
        renaming === null
          ? `Wert "${value}" hinzugefügt.`
          : `Wert "${renaming}" in "${value}" umbenannt.`,
      );
      setRenaming(null);
      setText("");
      onChanged();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div layout transition={{ layout: SPRING_LAYOUT }} className="rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-medium">
          {entry.schema}.{entry.name}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7 hover:bg-destructive/10 hover:text-destructive"
          onClick={onDrop}
          aria-label={`Enum "${entry.name}" löschen`}
          title={`Enum "${entry.name}" löschen`}
        >
          <Trash2Icon className="size-3.5" />
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {entry.values.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              setRenaming(label);
              setText(label);
            }}
            title={`Wert "${label}" umbenennen`}
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Badge
              variant={renaming === label ? "default" : "secondary"}
              className="px-1.5 py-0 font-mono text-[11px]"
            >
              {label}
            </Badge>
          </button>
        ))}
      </div>
      <form onSubmit={(event) => void handleSubmit(event)} className="mt-3 flex items-center gap-2">
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={renaming === null ? "Neuer Wert" : `Neuer Name für "${renaming}"`}
          aria-label={renaming === null ? "Neuer Enum-Wert" : `Neuer Name für "${renaming}"`}
          className="h-7 max-w-xs font-mono text-xs"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={saving || !value}
        >
          {renaming === null && <PlusIcon data-icon="inline-start" />}
          {renaming === null ? "Wert hinzufügen" : "Umbenennen"}
        </Button>
        {renaming !== null && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => {
              setRenaming(null);
              setText("");
            }}
          >
            Abbrechen
          </Button>
        )}
      </form>
    </motion.div>
  );
}
