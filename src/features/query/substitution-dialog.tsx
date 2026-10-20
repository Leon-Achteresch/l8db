import { NewBadge } from "@/components/new-badge";
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
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

interface SubstitutionDialogProps {
  open: boolean;
  names: string[];
  values: Record<string, string>;
  onValuesChange: (values: Record<string, string>) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SubstitutionDialog({
  open,
  names,
  values,
  onValuesChange,
  onConfirm,
  onCancel,
}: SubstitutionDialogProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("query.sqlplus-variables");
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm();
          }}
        >
          <DialogHeader>
            <DialogTitle ref={feature.ref} className="flex items-center gap-2">
              Substitutionsvariablen
              {feature.isNew && <NewBadge />}
            </DialogTitle>
            <DialogDescription>
              Werte für &amp;-Variablen ohne DEFINE. Sie werden wie in SQL*Plus als Text eingesetzt,
              auch in Literalen, und bleiben für diesen Tab bis zum Neustart gespeichert.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-80 pr-2">
            <div className="grid gap-3">
              {names.map((name, index) => (
                <div key={name} className="grid gap-1.5">
                  <Label htmlFor={`substitution-${name}`} className="font-mono text-xs">
                    &amp;{name}
                  </Label>
                  <Input
                    id={`substitution-${name}`}
                    className="h-8 font-mono"
                    autoFocus={index === 0}
                    value={values[name] ?? ""}
                    onChange={(event) => onValuesChange({ ...values, [name]: event.target.value })}
                  />
                </div>
              ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              Abbrechen
            </Button>
            <Button type="submit" size="sm">
              Ausführen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
