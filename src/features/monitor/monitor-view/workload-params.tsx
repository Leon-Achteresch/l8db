import { Input } from "@/components/ui/input";

interface WorkloadParamsProps {
  statementIndex: number;
  placeholders: string[];
  values: string[] | null;
  disabled: boolean;
  onChange: (statement: number, param: number, value: string) => void;
}

export function WorkloadParams({
  statementIndex,
  placeholders,
  values,
  disabled,
  onChange,
}: WorkloadParamsProps) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {placeholders.map((name, index) => (
        <div key={name} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-mono">{name}</span>
          <Input
            value={values?.[index] ?? ""}
            onChange={(event) => onChange(statementIndex, index, event.target.value)}
            className="h-6 w-32 font-mono text-[11px]"
            placeholder="Wert"
            aria-label={`Wert für ${name}`}
            disabled={disabled}
          />
        </div>
      ))}
    </div>
  );
}
