import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProfileLimit } from "@/lib/db";

interface ProfileLimitsPanelProps {
  limits: ProfileLimit[];
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}

const GROUPS = [
  { kind: "PASSWORD", label: "Passwort" },
  { kind: "KERNEL", label: "Ressourcen" },
];

export function ProfileLimitsPanel({ limits, value, onChange }: ProfileLimitsPanelProps) {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {GROUPS.map((group) => (
        <section key={group.kind} className="flex flex-col">
          <h3 className="px-2 pb-1 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
            {group.label}
          </h3>
          {limits
            .filter((limit) => limit.kind === group.kind)
            .map((limit) => {
              const current = value[limit.resource] ?? limit.value;
              const set = (next: string) => onChange({ ...value, [limit.resource]: next });
              return (
                <div
                  key={limit.resource}
                  className="group flex h-10 items-center gap-3 rounded-lg px-2 text-xs hover:bg-muted/50"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate font-mono">{limit.resource}</span>
                    {current.trim() !== limit.value && (
                      <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                    )}
                  </span>
                  <span className="flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    <Button variant="ghost" size="xs" onClick={() => set("UNLIMITED")}>
                      Unbegrenzt
                    </Button>
                    <Button variant="ghost" size="xs" onClick={() => set("DEFAULT")}>
                      Default
                    </Button>
                  </span>
                  <Input
                    value={current}
                    onChange={(event) => set(event.target.value)}
                    aria-label={limit.resource}
                    className="h-8 w-56 font-mono text-xs"
                  />
                </div>
              );
            })}
        </section>
      ))}
    </div>
  );
}
