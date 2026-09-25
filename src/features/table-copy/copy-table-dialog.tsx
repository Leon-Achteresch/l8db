import { ChevronsUpDownIcon, LoaderIcon } from "lucide-react";
import { ProviderLogo } from "@/components/provider-logo";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ConnectionPicker } from "@/features/connections/connection-picker";
import { providerFor } from "@/lib/connection-url";
import type { TableCopyMode } from "@/lib/db";
import { type TableCopySource, useTableCopy } from "./copy-table-dialog/use-table-copy";

const MODE_LABELS: Record<TableCopyMode, string> = {
  create: "Neu anlegen",
  truncate: "Leeren und füllen",
  append: "Anhängen",
};

export function CopyTableDialog({
  source,
  onClose,
}: {
  source: TableCopySource | null;
  onClose: () => void;
}) {
  const copy = useTableCopy(source, onClose);
  const { target, preview, busy } = copy;

  return (
    <Dialog open={source !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tabelle in andere Verbindung kopieren</DialogTitle>
          <DialogDescription>
            {source ? `${source.schema}.${source.name}` : ""} mit Daten übertragen. Typen werden für
            die Zieldatenbank umgesetzt.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Zielverbindung</Label>
            <ConnectionPicker
              value={copy.target?.id ?? null}
              onSelect={copy.setTargetId}
              label="Zielverbindung"
              contentClassName="flex max-h-80 w-(--radix-dropdown-menu-trigger-width) min-w-56 flex-col overflow-hidden"
              trigger={
                <button
                  type="button"
                  className="flex h-9 w-full items-center gap-2 rounded-md border bg-background px-3 text-left text-sm hover:bg-accent"
                >
                  {target ? (
                    <ProviderLogo
                      providerId={providerFor(target).id}
                      kind={target.kind}
                      className="size-4"
                    />
                  ) : null}
                  <span className="flex-1 truncate">{target?.name ?? "Verbindung wählen…"}</span>
                  <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
                </button>
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Zielschema</Label>
            <Select
              value={copy.targetSchema || undefined}
              onValueChange={copy.setTargetSchema}
              disabled={!copy.schemas?.length}
            >
              <SelectTrigger className="w-full min-w-0" aria-label="Zielschema">
                <SelectValue placeholder="Wählen…" />
              </SelectTrigger>
              <SelectContent searchable>
                {(copy.schemas ?? []).map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {entry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="table-copy-name">Zieltabelle</Label>
            <Input
              id="table-copy-name"
              value={copy.targetTable}
              onChange={(event) => copy.setTargetTable(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Modus</Label>
            <Select
              value={copy.mode}
              onValueChange={(value) => copy.setMode(value as TableCopyMode)}
            >
              <SelectTrigger className="w-full" aria-label="Modus">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(MODE_LABELS) as TableCopyMode[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {MODE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {copy.mode === "create" && (
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-2">
              <Switch
                id="table-copy-pk"
                checked={copy.includePrimaryKey}
                onCheckedChange={copy.setIncludePrimaryKey}
              />
              <Label htmlFor="table-copy-pk">Primärschlüssel übernehmen</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="table-copy-indexes"
                checked={copy.includeIndexes}
                onCheckedChange={copy.setIncludeIndexes}
              />
              <Label htmlFor="table-copy-indexes">Indizes übernehmen</Label>
            </div>
          </div>
        )}

        {copy.readOnly && (
          <p className="text-sm text-destructive">Die Zielverbindung ist schreibgeschützt.</p>
        )}
        {copy.unsupported && (
          <p className="text-sm text-destructive">
            Dieser Datenbanktyp wird als Ziel nicht unterstützt.
          </p>
        )}
        {copy.schemasError && (
          <p className="text-sm text-destructive">{String(copy.schemasError)}</p>
        )}

        {preview && (
          <div className="grid gap-2">
            {preview.error && <p className="text-sm text-destructive">{preview.error}</p>}
            {preview.warnings.map((warning) => (
              <p key={warning} className="text-xs text-amber-600 dark:text-amber-400">
                {warning}
              </p>
            ))}
            {preview.statements.length > 0 && (
              <pre className="max-h-60 overflow-auto rounded-md border bg-muted p-2 font-mono text-xs">
                {preview.statements.join(";\n\n")}
              </pre>
            )}
          </div>
        )}

        {busy && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {copy.progressRows} Zeilen kopiert
            </span>
            <Button variant="outline" size="sm" onClick={copy.cancel}>
              Abbrechen
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Schließen
          </Button>
          <Button
            variant="outline"
            onClick={() => void copy.run(true)}
            disabled={busy || !copy.ready}
          >
            Vorschau
          </Button>
          <Button onClick={() => void copy.run(false)} disabled={busy || !copy.ready}>
            {busy && <LoaderIcon className="size-3.5 animate-spin" />}
            Kopieren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
