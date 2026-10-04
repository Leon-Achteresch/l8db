import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { remoteStatus } from "@/lib/versioning/delivery";
import type { DeliveryRules } from "@/lib/versioning/types";

export function VersioningDeliveryRules({
  repo,
  value,
  production,
  onChange,
}: {
  repo: string;
  value: DeliveryRules | null;
  production: boolean;
  onChange: (value: DeliveryRules | null) => void;
}) {
  const remote = useQuery({
    queryKey: ["versioning-remote", repo, "identity"],
    retry: false,
    staleTime: 60_000,
    queryFn: () => remoteStatus(repo),
  });
  const identity = remote.data?.identity ?? null;
  return (
    <div className="space-y-2 rounded-lg bg-muted/30 p-3">
      <p className="font-medium">Auslieferung</p>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={Boolean(value)}
          disabled={!value && !identity}
          onChange={(event) =>
            onChange(
              event.target.checked && identity
                ? { repository: identity, review: true, approvals: 1, testFirst: production }
                : null,
            )
          }
        />
        Nur gemergte Releases aus dem Hauptbranch des gemeinsamen Repositorys
      </label>
      {value && (
        <>
          <div className="flex items-center gap-2">
            <input
              id={`delivery-review-${repo}`}
              type="checkbox"
              checked={value.review}
              onChange={(event) =>
                onChange({
                  ...value,
                  review: event.target.checked,
                  approvals: Math.max(1, value.approvals),
                })
              }
            />
            <label htmlFor={`delivery-review-${repo}`}>Freigabe im Pull Request, mindestens</label>
            <Input
              type="number"
              min={1}
              max={10}
              aria-label="Mindestanzahl Freigaben"
              disabled={!value.review}
              value={value.approvals}
              onChange={(event) =>
                onChange({
                  ...value,
                  approvals: Math.min(10, Math.max(1, Math.trunc(Number(event.target.value)) || 1)),
                })
              }
              className="h-7 w-14 text-xs"
            />
          </div>
          {production && (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={value.testFirst}
                onChange={(event) => onChange({ ...value, testFirst: event.target.checked })}
              />
              Erst wenn derselbe Release fehlerfrei auf einem Testsystem des Kunden läuft
            </label>
          )}
          <p className="break-all text-[10px] text-muted-foreground">
            Gebunden an {value.repository}
          </p>
          {identity && identity !== value.repository && (
            <p className="text-[10px] text-amber-700 dark:text-amber-300">
              Das geöffnete Repository ({identity}) weicht ab. Auslieferungen daraus sind gesperrt.
            </p>
          )}
        </>
      )}
      {!value && !identity && remote.data && (
        <p className="text-[10px] text-muted-foreground">
          Dafür braucht das Repository einen Remote „origin“.
        </p>
      )}
    </div>
  );
}
