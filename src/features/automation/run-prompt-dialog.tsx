import { PlayIcon } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useAutomationStore } from "@/lib/automation/store";
import { toast } from "@/lib/automation/toast";
import type { Variable } from "@/lib/db/automation";

const INPUT_TYPES: Partial<Record<Variable["kind"], string>> = {
  number: "number",
  date: "date",
  secret: "password",
};

export function RunPromptDialog() {
  const summary = useAutomationStore((state) => state.runPrompt);
  const close = useAutomationStore((state) => state.closeRunPrompt);
  const startRun = useAutomationStore((state) => state.startRun);
  const [values, setValues] = useState<Record<string, string>>({});
  const [environment, setEnvironment] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const task = summary?.task;
  const prompted = task?.variables.filter((variable) => variable.prompt) ?? [];

  useEffect(() => {
    if (!task) return;
    setValues(
      Object.fromEntries(
        task.variables
          .filter((variable) => variable.prompt && variable.kind !== "secret")
          .map((variable) => [variable.name, variable.defaultValue]),
      ),
    );
    setEnvironment(task.defaultEnvironment ?? task.environments[0]?.name ?? null);
  }, [task]);

  const submit = async () => {
    if (!task) return;
    setBusy(true);
    try {
      const vars = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ""));
      await startRun({ taskId: task.id, vars, environment });
      toast.success(`„${task.name}“ gestartet`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const set = (name: string, value: string) =>
    setValues((current) => ({ ...current, [name]: value }));

  return (
    <Dialog open={Boolean(task)} onOpenChange={(open) => !open && !busy && close()}>
      <DialogContent className="sm:max-w-md" data-testid="automation-run-prompt">
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>„{task?.name}“ ausführen</DialogTitle>
            <DialogDescription>
              Werte gelten nur für diesen Lauf. Leere Felder nutzen den Standardwert.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {task && task.environments.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="run-environment">Umgebung</Label>
                <Select value={environment ?? ""} onValueChange={setEnvironment}>
                  <SelectTrigger id="run-environment" className="w-full">
                    <SelectValue placeholder="Umgebung wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {task.environments.map((entry) => (
                      <SelectItem key={entry.name} value={entry.name}>
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {prompted.map((variable) => {
              const id = `run-var-${variable.name}`;
              const value = values[variable.name] ?? "";
              if (variable.kind === "boolean")
                return (
                  <div key={variable.name} className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <Label htmlFor={id}>{variable.name}</Label>
                      {variable.description && (
                        <span className="text-xs text-muted-foreground">
                          {variable.description}
                        </span>
                      )}
                    </div>
                    <Switch
                      id={id}
                      checked={value === "true"}
                      onCheckedChange={(checked) => set(variable.name, String(checked))}
                    />
                  </div>
                );
              return (
                <div key={variable.name} className="flex flex-col gap-1.5">
                  <Label htmlFor={id}>{variable.name}</Label>
                  {variable.kind === "choice" ? (
                    <Select value={value} onValueChange={(next) => set(variable.name, next)}>
                      <SelectTrigger id={id} className="w-full">
                        <SelectValue placeholder="Wert wählen" />
                      </SelectTrigger>
                      <SelectContent>
                        {variable.choices.map((choice) => (
                          <SelectItem key={choice} value={choice}>
                            {choice}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={id}
                      type={INPUT_TYPES[variable.kind] ?? "text"}
                      value={value}
                      autoComplete="off"
                      placeholder={
                        variable.kind === "secret"
                          ? "Gespeicherten Wert verwenden"
                          : variable.defaultValue
                      }
                      onChange={(event) => set(variable.name, event.target.value)}
                    />
                  )}
                  {variable.description && (
                    <span className="text-xs text-muted-foreground">{variable.description}</span>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={close}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner className="size-3.5" /> : <PlayIcon />}
              Ausführen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
