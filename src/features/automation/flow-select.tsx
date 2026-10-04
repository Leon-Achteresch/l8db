import { ArrowDownIcon, CornerDownRightIcon, OctagonXIcon, SquareCheckIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Flow, Step } from "@/lib/db/automation";

interface Props {
  value: Flow;
  onChange: (value: Flow) => void;
  siblings: Step[];
  currentId: string | null;
  label: string;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

function encode(flow: Flow): string {
  return flow.type === "goto" ? `goto:${flow.stepId}` : flow.type;
}

function decode(value: string): Flow {
  if (value.startsWith("goto:")) return { type: "goto", stepId: value.slice(5) };
  return { type: value as "next" | "end_success" | "end_failure" };
}

export function FlowSelect({
  value,
  onChange,
  siblings,
  currentId,
  label,
  id,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
}: Props) {
  const targets = siblings
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.id !== currentId);
  const missing =
    value.type === "goto" && !siblings.some((step) => step.id === value.stepId)
      ? value.stepId
      : null;

  return (
    <Select value={encode(value)} onValueChange={(next) => onChange(decode(next))}>
      <SelectTrigger
        id={id}
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className="h-[calc(2.25rem+var(--ui-density-step))] w-full min-w-0 rounded-lg"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="next">
          <ArrowDownIcon className="size-3.5 text-muted-foreground" />
          Nächster Schritt
        </SelectItem>
        <SelectItem value="end_success">
          <SquareCheckIcon className="size-3.5 text-emerald-600" />
          Erfolgreich beenden
        </SelectItem>
        <SelectItem value="end_failure">
          <OctagonXIcon className="size-3.5 text-destructive" />
          Mit Fehler beenden
        </SelectItem>
        {(targets.length > 0 || missing) && <SelectSeparator />}
        {(targets.length > 0 || missing) && (
          <SelectGroup>
            <SelectLabel>Gehe zu …</SelectLabel>
            {missing && (
              <SelectItem value={`goto:${missing}`}>
                <CornerDownRightIcon className="size-3.5 text-destructive" />
                Gelöschter Schritt
              </SelectItem>
            )}
            {targets.map(({ step, index }) => (
              <SelectItem key={step.id} value={`goto:${step.id}`}>
                <CornerDownRightIcon className="size-3.5 text-muted-foreground" />
                <span className="tabular-nums text-muted-foreground">{index + 1}</span>
                <span className="truncate">{step.name || "Unbenannt"}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
