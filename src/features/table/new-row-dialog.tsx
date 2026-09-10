import { Loader2Icon, PlusIcon } from "lucide-react";
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
import { cn } from "@/lib/utils";

type FieldMode = "default" | "null" | "value";

type FieldState = {
  mode: FieldMode;
  value: string;
};

type NewRowDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schema: string;
  table: string;
  columns: string[];
  isPending: boolean;
  onSubmit: (values: Record<string, string | null>) => Promise<void>;
};

function initialFields(columns: string[]): Record<string, FieldState> {
  return Object.fromEntries(
    columns.map((col) => [col, { mode: "default", value: "" } as FieldState]),
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
}: NewRowDialogProps) {
  const [fields, setFields] = useState<Record<string, FieldState>>(() => initialFields(columns));

  useEffect(() => {
    if (open) {
      setFields(initialFields(columns));
    }
  }, [open, columns]);

  const setMode = (col: string, mode: FieldMode) => {
    setFields((prev) => ({ ...prev, [col]: { ...prev[col], mode } }));
  };

  const setValue = (col: string, value: string) => {
    setFields((prev) => ({ ...prev, [col]: { mode: "value", value } }));
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
            <PlusIcon className="size-4 text-primary" />
            Neue Zeile
            <span className="font-mono text-sm font-normal text-muted-foreground">
              {schema}.{table}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Leere Felder verwenden den Standardwert der Spalte.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-3 px-4 py-4">
            {columns.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Keine Spalten verfügbar.
              </p>
            )}
            {columns.map((col) => {
              const field = fields[col] ?? { mode: "default", value: "" };
              return (
                <div key={col} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs font-semibold text-foreground/80">
                      {col}
                    </span>
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
