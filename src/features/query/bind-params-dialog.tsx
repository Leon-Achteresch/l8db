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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BIND_PARAM_TYPE_LABELS,
  BIND_PARAM_TYPES,
  type BindParamRef,
  type BindParamType,
  type BindParamValue,
  validateBindParams,
} from "@/lib/bind-params";

interface BindParamsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refs: BindParamRef[];
  values: Record<string, BindParamValue>;
  onValuesChange: (values: Record<string, BindParamValue>) => void;
  onConfirm: () => void;
  inline?: boolean;
}

export function BindParamsDialog({
  open,
  onOpenChange,
  refs,
  values,
  onValuesChange,
  onConfirm,
  inline = false,
}: BindParamsDialogProps) {
  const errors = validateBindParams(refs, values);
  const update = (name: string, patch: Partial<BindParamValue>) => {
    const current = values[name] ?? { type: "text" as BindParamType, value: "" };
    onValuesChange({ ...values, [name]: { ...current, ...patch } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bind-Parameter</DialogTitle>
          <DialogDescription>
            {inline
              ? "Werte werden als Literale in den SQL-Text eingesetzt."
              : "Werte werden gebunden und nicht in den SQL-Text eingesetzt. Der Verlauf speichert nur die Abfrage mit Platzhaltern."}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-80 pr-2">
          <div className="grid gap-3">
            {refs.map((ref) => {
              const entry = values[ref.name] ?? { type: "text" as BindParamType, value: "" };
              return (
                <div key={ref.label} className="grid gap-1.5">
                  <Label htmlFor={`bind-${ref.name}`} className="font-mono text-xs">
                    {ref.label}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Select
                      value={entry.type}
                      onValueChange={(type) => update(ref.name, { type: type as BindParamType })}
                    >
                      <SelectTrigger size="sm" className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BIND_PARAM_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {BIND_PARAM_TYPE_LABELS[type]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      id={`bind-${ref.name}`}
                      className="h-8 flex-1"
                      value={entry.type === "null" ? "" : entry.value}
                      disabled={entry.type === "null"}
                      placeholder={entry.type === "null" ? "NULL" : "Wert"}
                      onChange={(event) => update(ref.name, { value: event.target.value })}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
        {errors.length > 0 && (
          <ul className="grid gap-1 text-xs text-destructive">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button size="sm" disabled={errors.length > 0} onClick={onConfirm}>
            Ausführen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
