import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDatabaseAction } from "./use-database-action";

const METHODS = ["btree", "hash", "gist", "spgist", "gin", "brin"];

export function DatabaseIndexDialog({
  reference,
  schema,
  open,
  onOpenChange,
}: {
  reference: string;
  schema: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const action = useDatabaseAction(reference);
  const [table, setTable] = useState("");
  const [columns, setColumns] = useState("");
  const [name, setName] = useState("");
  const [method, setMethod] = useState("btree");
  const [unique, setUnique] = useState(false);
  const [concurrently, setConcurrently] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            action.mutate(
              {
                action: "create_index",
                schema,
                table: table.trim(),
                name: name.trim(),
                columns: columns
                  .split(",")
                  .map((column) => column.trim())
                  .filter(Boolean),
                method,
                unique,
                concurrently,
              },
              {
                onSuccess: () => {
                  setTable("");
                  setColumns("");
                  setName("");
                  onOpenChange(false);
                },
              },
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Index erstellen</DialogTitle>
            <DialogDescription>Schema {schema}</DialogDescription>
          </DialogHeader>
          <Input
            value={table}
            onChange={(event) => setTable(event.target.value)}
            placeholder="Tabelle"
            aria-label="Tabelle"
            required
          />
          <Input
            value={columns}
            onChange={(event) => setColumns(event.target.value)}
            placeholder="Spalten, durch Komma getrennt"
            aria-label="Spalten"
            required
          />
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name (optional)"
            aria-label="Indexname"
          />
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger aria-label="Methode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label className="flex items-center gap-2 text-xs">
            <Checkbox checked={unique} onCheckedChange={(value) => setUnique(value === true)} />
            Eindeutig (UNIQUE)
          </Label>
          <Label className="flex items-start gap-2 text-xs">
            <Checkbox
              checked={concurrently}
              onCheckedChange={(value) => setConcurrently(value === true)}
            />
            <span>
              Ohne Tabellensperre (CONCURRENTLY)
              <span className="block font-normal text-muted-foreground">
                Läuft außerhalb einer Transaktion. Bricht der Aufbau ab, bleibt ein ungültiger Index
                zurück, der gelöscht werden muss.
              </span>
            </span>
          </Label>
          <DialogFooter>
            <Button type="submit" disabled={action.isPending}>
              Erstellen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
