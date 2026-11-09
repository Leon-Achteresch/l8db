import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBytes } from "@/lib/backup";
import type { PrincipalQuota } from "@/lib/db";

const MB = 1024 * 1024;

interface QuotasPanelProps {
  tablespaces: string[];
  value: Record<string, number>;
  original: PrincipalQuota[];
  onChange: (value: Record<string, number>) => void;
}

export function QuotasPanel({ tablespaces, value, original, onChange }: QuotasPanelProps) {
  const before = new Map(original.map((quota) => [quota.tablespace, quota]));
  const names = [...new Set([...tablespaces, ...before.keys(), ...Object.keys(value)])];

  return (
    <div className="flex max-w-3xl flex-col">
      <div className="flex h-6 items-center gap-3 px-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
        <span className="flex-1">Tablespace</span>
        <span className="w-24 text-right">Belegt</span>
        <span className="w-64">Quota</span>
      </div>
      {names.map((name) => {
        const max = value[name] ?? 0;
        const mode = max < 0 ? "unlimited" : max > 0 ? "limit" : "none";
        const changed = (before.get(name)?.max_bytes ?? 0) !== max;
        return (
          <div
            key={name}
            className="flex h-10 items-center gap-3 rounded-lg px-2 text-xs hover:bg-muted/50"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate font-mono">{name}</span>
              {changed && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
            </span>
            <span className="w-24 text-right text-muted-foreground tabular-nums">
              {formatBytes(before.get(name)?.bytes ?? 0)}
            </span>
            <span className="flex w-64 items-center gap-2">
              <Select
                value={mode}
                onValueChange={(next) =>
                  onChange({
                    ...value,
                    [name]: next === "unlimited" ? -1 : next === "limit" ? 100 * MB : 0,
                  })
                }
              >
                <SelectTrigger size="sm" className="w-32 text-xs" aria-label={`Quota ${name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Keine</SelectItem>
                  <SelectItem value="limit">Limit</SelectItem>
                  <SelectItem value="unlimited">Unbegrenzt</SelectItem>
                </SelectContent>
              </Select>
              {mode === "limit" && (
                <>
                  <Input
                    type="number"
                    min={1}
                    value={Math.round((max / MB) * 100) / 100}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        [name]: Math.max(MB, Math.round(Number(event.target.value) * MB)),
                      })
                    }
                    aria-label={`Quota ${name} in MB`}
                    className="h-8 w-24 text-xs tabular-nums"
                  />
                  <span className="text-muted-foreground">MB</span>
                </>
              )}
            </span>
          </div>
        );
      })}
      {names.length === 0 && (
        <p className="px-2 py-3 text-[13px] text-muted-foreground">Keine Tablespaces.</p>
      )}
    </div>
  );
}
