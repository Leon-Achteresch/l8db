import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DbEnum } from "@/lib/db/supabase-studio-database";
import { useDatabaseAction } from "./use-database-action";

export function DatabaseEnumRow({ reference, item }: { reference: string; item: DbEnum }) {
  const action = useDatabaseAction(reference);
  const [added, setAdded] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  return (
    <div className="flex flex-col gap-1.5">
      <form
        className="flex gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          action.mutate(
            { action: "add_enum_value", schema: item.schema, name: item.name, value: added.trim() },
            { onSuccess: () => setAdded("") },
          );
        }}
      >
        <Input
          className="h-7 w-32 text-xs"
          value={added}
          onChange={(event) => setAdded(event.target.value)}
          placeholder="Neuer Wert"
          aria-label={`Neuer Wert für ${item.name}`}
          required
        />
        <Button size="xs" variant="outline" type="submit" disabled={action.isPending}>
          Hinzufügen
        </Button>
      </form>
      <form
        className="flex gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          action.mutate(
            {
              action: "rename_enum_value",
              schema: item.schema,
              name: item.name,
              from,
              to: to.trim(),
            },
            {
              onSuccess: () => {
                setFrom("");
                setTo("");
              },
            },
          );
        }}
      >
        <Select value={from} onValueChange={setFrom}>
          <SelectTrigger
            size="sm"
            className="h-7 w-32 text-xs"
            aria-label={`Wert von ${item.name} umbenennen`}
          >
            <SelectValue placeholder="Wert" />
          </SelectTrigger>
          <SelectContent>
            {item.enum_values.map((value) => (
              <SelectItem key={value} value={value} className="text-xs">
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="h-7 w-28 text-xs"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          placeholder="Neuer Name"
          aria-label="Neuer Name des Werts"
          required
        />
        <Button size="xs" variant="outline" type="submit" disabled={!from || action.isPending}>
          Umbenennen
        </Button>
      </form>
    </div>
  );
}
