import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PrincipalDraft } from "@/features/users/principal-view/principal-draft";
import type { PrincipalDetail } from "@/lib/db";

interface PrincipalOverviewProps {
  detail: PrincipalDetail;
  before: PrincipalDraft;
  draft: PrincipalDraft;
  tablespaces: string[];
  temporaryTablespaces: string[];
  profiles: string[];
  onChange: (patch: Partial<PrincipalDraft>) => void;
}

export function PrincipalOverview({
  detail,
  before,
  draft,
  tablespaces,
  temporaryTablespaces,
  profiles,
  onChange,
}: PrincipalOverviewProps) {
  const choices = [
    {
      label: "Standard-Tablespace",
      value: draft.defaultTablespace,
      before: before.defaultTablespace,
      options: tablespaces,
      set: (value: string) => onChange({ defaultTablespace: value }),
    },
    {
      label: "Temp-Tablespace",
      value: draft.temporaryTablespace,
      before: before.temporaryTablespace,
      options: temporaryTablespaces,
      set: (value: string) => onChange({ temporaryTablespace: value }),
    },
    {
      label: "Profil",
      value: draft.profile,
      before: before.profile,
      options: profiles,
      set: (value: string) => onChange({ profile: value }),
    },
  ];
  const facts = [
    ["Authentifizierung", detail.authentication],
    ["Erstellt", detail.created],
    ["Letzter Login", detail.last_login],
    ["Gesperrt seit", detail.lock_date],
    ["Passwort läuft ab", detail.expiry_date],
  ].filter((fact): fact is [string, string] => Boolean(fact[1]));

  return (
    <div className="grid max-w-xl grid-cols-[11rem_1fr] items-center gap-x-4 gap-y-2 text-[13px]">
      {choices.map((choice) => (
        <div key={choice.label} className="contents">
          <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            {choice.label}
            {choice.value !== choice.before && (
              <span className="size-1.5 rounded-full bg-primary" />
            )}
          </span>
          <Select value={choice.value} onValueChange={choice.set}>
            <SelectTrigger size="sm" className="w-64 font-mono text-xs" aria-label={choice.label}>
              <SelectValue placeholder="–" />
            </SelectTrigger>
            <SelectContent>
              {[...new Set([...choice.options, choice.before].filter(Boolean))].map((option) => (
                <SelectItem key={option} value={option} className="font-mono text-xs">
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
      {facts.map(([label, value]) => (
        <div key={label} className="contents">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <span className="py-1.5 tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  );
}
