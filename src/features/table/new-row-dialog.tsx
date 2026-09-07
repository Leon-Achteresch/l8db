import { CopyPlusIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";

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
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DuplicatePrefill } from "@/lib/row-duplicate";
import { cn } from "@/lib/utils";

type FieldMode = "default" | "null" | "value";

type FieldState = {
  mode: FieldMode;
  value: string;
  isPrimaryKey: boolean;
  cleared: boolean;
};

type NewRowDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schema: string;
  table: string;
  columns: string[];
  isPending: boolean;
  onSubmit: (values: Record<string, string | null>) => Promise<void>;
  prefill?: DuplicatePrefill | null;
  errorMessage?: string | null;
};

function initialFields(
  columns: string[],
  prefill?: DuplicatePrefill | null,
): Record<string, FieldState> {
  return Object.fromEntries(
    columns.map((col) => {
      const preset = prefill?.[col];
      return [
        col,
        {
          mode: preset?.mode ?? "default",
          value: preset?.value ?? "",
          isPrimaryKey: preset?.isPrimaryKey ?? false,
          cleared: preset?.cleared ?? false,
        } as FieldState,
      ];
    }),
  );
}

export function NewRowDialog({
  open,
  onOpenChange,
  schema,
  table,
  columns,
  isPending,
  onSubmit,
  prefill,
  errorMessage,
}: NewRowDialogProps) {
  const isDuplicate = !!prefill;
  const [fields, setFields] = useState<Record<string, FieldState>>(() =>
    initialFields(columns, prefill),
  );

  useEffect(() => {
    if (open) {
      setFields(initialFields(columns, prefill));
    }
  }, [open, columns, prefill]);

  const setMode = (col: string, mode: FieldMode) => {
    setFields((prev) => ({ ...prev, [col]: { ...prev[col], mode } }));
  };

  const setValue = (col: string, value: string) => {
    setFields((prev) => ({ ...prev, [col]: { ...prev[col], mode: "value", value } }));
  };

  const handleSubmit = async () => {
    const values: Record<string, string | null> = {};
    for (const col of columns) {
      const field = fields[col];
      if (!field) continue;
      if (field.mode === "value") {
        values[col] = field.value;
      } else if (field.mode === "null") {
        values[col] = null;
      }
    }
    await onSubmit(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-lg gap-0 p-0 overflow-hidden">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            {isDuplicate ? (
              <CopyPlusIcon className="size-4 text-primary" />
            ) : (
              <PlusIcon className="size-4 text-primary" />
            )}
            {isDuplicate ? "Zeile duplizieren" : "Neue Zeile"}
            <span className="font-mono text-sm font-normal text-muted-foreground">
              {schema}.{table}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isDuplicate
              ? "Werte der Quellzeile sind vorbelegt. Schlüssel- und Standardspalten vor dem Einfügen prüfen."
              : "Leere Felder verwenden den Standardwert der Spalte."}
          </DialogDescription>
        </DialogHeader>

        {errorMessage && (
          <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs whitespace-pre-wrap text-destructive">
            {errorMessage}
          </div>
        )}

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-3 px-4 py-4">
            {columns.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Keine Spalten verfügbar.
              </p>
            )}
            {columns.map((col) => {
              const field = fields[col] ?? {
                mode: "default" as FieldMode,
                value: "",
                isPrimaryKey: false,
                cleared: false,
              };
              return (
                <div key={col} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-mono text-xs font-semibold text-foreground/80">
                        {col}
                      </span>
                      {field.isPrimaryKey && (
                        <span className="shrink-0 rounded border border-primary/40 bg-primary/10 px-1 py-0.5 text-[9px] font-semibold tracking-wide text-primary uppercase">
                          PK
                        </span>
                      )}
                      {isDuplicate && field.cleared && (
                        <span className="shrink-0 text-[9px] tracking-wide text-muted-foreground uppercase">
                          auto
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <ModeChip
                        active={field.mode === "default"}
                        onClick={() => setMode(col, "default")}
                      >
                        Standard
                      </ModeChip>
                      <ModeChip active={field.mode === "null"} onClick={() => setMode(col, "null")}>
                        NULL
                      </ModeChip>
                    </div>
                  </div>
                  <Input
                    value={field.mode === "value" ? field.value : ""}
                    disabled={isPending}
                    onChange={(e) => setValue(col, e.target.value)}
                    onFocus={() => {
                      if (field.mode !== "value") setMode(col, "value");
                    }}
                    placeholder={
                      field.mode === "null"
                        ? "NULL"
                        : field.mode === "default"
                          ? "Standardwert"
                          : ""
                    }
                    className={cn(
                      "h-8 font-mono text-[13px]",
                      field.mode !== "value" && "text-muted-foreground/60 italic",
                    )}
                  />
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="border-t bg-muted/30 px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Abbrechen
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={isPending || columns.length === 0}
          >
            {isPending ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : isDuplicate ? (
              <CopyPlusIcon className="size-3.5" />
            ) : (
              <PlusIcon className="size-3.5" />
            )}
            Einfügen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors cursor-pointer",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
