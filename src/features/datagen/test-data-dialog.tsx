import { SparklesIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SavedConnection } from "@/lib/connections";
import type { DatagenLocale } from "@/lib/db";
import { useCapabilities } from "@/lib/providers";
import { DatagenColumnRow } from "./datagen-column-row";
import { DatagenMaskRow } from "./datagen-mask-row";
import { DatagenPreviewTable } from "./datagen-preview-table";
import { type DatagenMode, useTestData } from "./use-test-data";

interface Props {
  connection: SavedConnection;
  database: string | null;
  schema: string;
  table: string;
  readOnly: boolean;
  onComplete: () => void;
}

function numeric(text: string, fallback: number): number {
  const value = Math.round(Number(text));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function TestDataDialog({
  connection,
  database,
  schema,
  table,
  readOnly,
  onComplete,
}: Props) {
  const [open, setOpen] = useState(false);
  const state = useTestData({ open, connection, database, schema, table, onComplete });
  const transactional = useCapabilities(connection.kind).transactions;
  const blocked = readOnly || state.running || state.loading || state.issues.length > 0;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="Testdaten generieren"
            onClick={() => setOpen(true)}
          >
            <SparklesIcon className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Testdaten / Maskierte Kopie</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={(next) => !state.running && setOpen(next)}>
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Testdaten · {[schema, table].filter(Boolean).join(".")}</DialogTitle>
            <DialogDescription>
              Generatoren werden aus Spaltenname und Typ vorgeschlagen. Fremdschlüssel nutzen
              vorhandene Elternschlüssel, eindeutige Spalten werden dedupliziert.
            </DialogDescription>
          </DialogHeader>
          <Tabs value={state.mode} onValueChange={(value) => state.setMode(value as DatagenMode)}>
            <TabsList>
              <TabsTrigger value="generate" disabled={state.running}>
                Generieren
              </TabsTrigger>
              <TabsTrigger value="copy" disabled={state.running}>
                Maskierte Kopie
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {state.mode === "copy" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label htmlFor="datagen-target-schema" className="text-xs">
                  Zielschema
                </Label>
                <Input
                  id="datagen-target-schema"
                  value={state.targetSchema}
                  onChange={(event) => state.setTargetSchema(event.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="datagen-target-table" className="text-xs">
                  Zieltabelle (gleiche Spaltennamen)
                </Label>
                <Input
                  id="datagen-target-table"
                  value={state.targetTable}
                  onChange={(event) => state.setTargetTable(event.target.value)}
                />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="grid gap-1">
              <Label htmlFor="datagen-rows" className="text-xs">
                {state.mode === "copy" ? "Max. Zeilen" : "Zeilen"}
              </Label>
              <Input
                id="datagen-rows"
                type="number"
                min={1}
                value={state.rows}
                onChange={(event) => state.setRows(numeric(event.target.value, state.rows))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="datagen-batch" className="text-xs">
                Batchgröße
              </Label>
              <Input
                id="datagen-batch"
                type="number"
                min={1}
                value={state.batchSize}
                onChange={(event) =>
                  state.setBatchSize(Math.max(1, numeric(event.target.value, state.batchSize)))
                }
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="datagen-seed" className="text-xs">
                Seed
              </Label>
              <Input
                id="datagen-seed"
                type="number"
                min={0}
                value={state.seed}
                onChange={(event) => state.setSeed(numeric(event.target.value, state.seed))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="datagen-locale" className="text-xs">
                Sprache
              </Label>
              <Select
                value={state.locale}
                onValueChange={(value) => state.setLocale(value as DatagenLocale)}
              >
                <SelectTrigger id="datagen-locale" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="de">Deutsch</SelectItem>
                  <SelectItem value="en">Englisch</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end justify-between gap-2 pb-2 text-xs font-medium">
              <Label htmlFor="datagen-transaction" className="text-xs">
                Eine Transaktion
              </Label>
              <Switch
                id="datagen-transaction"
                checked={transactional && state.transaction}
                onCheckedChange={state.setTransaction}
                disabled={!transactional}
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border px-3 py-1">
            {state.loading && (
              <p className="py-6 text-center text-xs text-muted-foreground">Lade Spalten…</p>
            )}
            {!state.loading &&
              state.columns.map((column) =>
                state.mode === "copy" ? (
                  <DatagenMaskRow
                    key={column.name}
                    column={column}
                    mask={state.masks.find((mask) => mask.column === column.name) ?? null}
                    onColumn={(patch) => state.updateColumn(column.name, patch)}
                    onMask={(mask) => state.setMask(column.name, mask)}
                  />
                ) : (
                  <DatagenColumnRow
                    key={column.name}
                    column={column}
                    onChange={(patch) => state.updateColumn(column.name, patch)}
                  />
                ),
              )}
          </div>
          {state.preview && <DatagenPreviewTable preview={state.preview} />}
          {state.running && (
            <div className="space-y-1">
              <Progress value={Math.min(100, (state.progress / Math.max(1, state.rows)) * 100)} />
              <p className="text-xs text-muted-foreground tabular-nums">
                {state.progress.toLocaleString("de-DE")} / {state.rows.toLocaleString("de-DE")}{" "}
                Zeilen
              </p>
            </div>
          )}
          {readOnly && (
            <p className="text-xs text-amber-600">
              Verbindung ist schreibgeschützt – nur Vorschau möglich.
            </p>
          )}
          {[...state.issues, ...(state.error ? [state.error] : [])].map((issue) => (
            <p key={issue} className="text-xs text-destructive">
              {issue}
            </p>
          ))}
          <DialogFooter>
            {state.running ? (
              <Button variant="outline" onClick={state.cancel}>
                Abbrechen
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setOpen(false)}>
                Schließen
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={state.previewing || state.loading || state.issues.length > 0}
              onClick={() => void state.loadPreview()}
            >
              Vorschau (20 Zeilen)
            </Button>
            <Button disabled={blocked} onClick={() => void state.run()}>
              {state.mode === "copy" ? "Kopieren" : "Generieren"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
