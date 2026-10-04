import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  DatabaseIcon,
  DraftingCompassIcon,
  EyeOffIcon,
} from "lucide-react";
import { useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { effectiveRules, invalidRules, uncovered } from "@/lib/branching/masking";
import {
  isMasked,
  METHOD_LABELS,
  snapshotsFor,
  sourceChoices,
  suggestBranchName,
  validBranchName,
} from "@/lib/branching/model";
import { type BranchKind, type BranchMethod, branchingColumns, branchingRun } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";
import { VersioningSelect } from "../versioning-select";
import type { BranchingWorkspace } from "./use-branching";

export interface BranchPreset {
  source: string;
  snapshot: string | null;
}

const TTL_OPTIONS = [
  { value: "0", label: "Kein Ablauf" },
  { value: "24", label: "1 Tag" },
  { value: "72", label: "3 Tage" },
  { value: "168", label: "7 Tage" },
  { value: "720", label: "30 Tage" },
];

const METHOD_OPTIONS = [
  { value: "auto", label: "Automatisch (empfohlen)" },
  { value: "clone", label: "Sofort-Klon" },
  { value: "stream", label: "Datenstrom (auch unter Last)" },
];

export function BranchCreateDialog({
  workspace,
  preset,
  onClose,
  onPolicies,
}: {
  workspace: BranchingWorkspace;
  preset: BranchPreset;
  onClose: () => void;
  onPolicies: () => void;
}) {
  const overview = workspace.overview;
  const sources = overview ? sourceChoices(overview.databases) : [];
  const taken = overview?.databases.map((entry) => entry.name) ?? [];
  const sourceNames = sources.map((entry) => entry.name);
  if (preset.snapshot && preset.source && !sourceNames.includes(preset.source))
    sourceNames.push(preset.source);
  const [source, setSource] = useState(
    sourceNames.includes(preset.source) ? preset.source : (overview?.root ?? ""),
  );
  const [snapshot, setSnapshot] = useState(preset.snapshot ?? "");
  const [name, setName] = useState(() => suggestBranchName(overview?.root ?? "", taken));
  const sourceInfo = overview?.databases.find((entry) => entry.name === source);
  const live = Boolean(sourceInfo);
  const rootInfo = overview?.databases.find((entry) => entry.name === overview.root);
  const strict = isMasked(sourceInfo) || isMasked(rootInfo);
  const [kind, setKind] = useState<BranchKind>(strict ? "anonymized" : "full");
  const [method, setMethod] = useState<BranchMethod>("auto");
  const defaultTtl = overview?.policy.branchTtlHours;
  const [ttl, setTtl] = useState(defaultTtl ? String(defaultTtl) : "0");
  const [locked, setLocked] = useState(false);
  const anonymizedFeature = useNewFeatureVisibility<HTMLButtonElement>(
    "versioning.database.anonymized",
  );
  const columns = useQuery({
    queryKey: ["branching-columns", workspace.connection.id, source],
    enabled: kind === "anonymized" && !snapshot && Boolean(source),
    retry: false,
    staleTime: 60_000,
    queryFn: () => branchingColumns(workspace.url(), source),
  });
  if (!overview) return null;
  const snapshots = snapshotsFor(overview.snapshots, source);
  const rules = effectiveRules(rootInfo?.marker?.masking ?? [], strict, overview.policy.masking);
  const missing = columns.data ? uncovered(columns.data, rules) : [];
  const invalid = columns.data ? invalidRules(columns.data, rules) : [];
  const nameError =
    validBranchName(name) ?? (taken.includes(name) ? "Dieser Name ist bereits vergeben." : null);
  const ttlOptions =
    defaultTtl && !TTL_OPTIONS.some((option) => option.value === String(defaultTtl))
      ? [...TTL_OPTIONS, { value: String(defaultTtl), label: `${defaultTtl} Stunden (Richtlinie)` }]
      : TTL_OPTIONS;
  const coverageOpen =
    kind === "anonymized" &&
    !snapshot &&
    (columns.isLoading || Boolean(columns.error) || missing.length > 0 || invalid.length > 0);
  const anonymizeBlocked = !overview.tools.anonymize;
  const ready =
    !nameError &&
    Boolean(source) &&
    (live || Boolean(snapshot)) &&
    !(kind === "full" && strict) &&
    !(kind === "anonymized" && anonymizeBlocked) &&
    !coverageOpen;
  const kinds: {
    id: BranchKind;
    title: string;
    detail: string;
    icon: typeof DatabaseIcon;
    disabled: string | null;
  }[] = [
    {
      id: "full",
      title: "Vollständig",
      detail: overview.server.instantClone
        ? "Schema und Daten. Unbenutzte Quellen werden per Sofort-Klon in Sekunden kopiert."
        : "Schema und Daten als eigenständige Kopie.",
      icon: DatabaseIcon,
      disabled: strict ? "Die Quelle ist maskiert geschützt." : null,
    },
    {
      id: "schema",
      title: "Nur Schema",
      detail: "Struktur ohne Daten – für Migrationen, Reviews und Tests.",
      icon: DraftingCompassIcon,
      disabled: null,
    },
    {
      id: "anonymized",
      title: "Anonymisiert",
      detail: "Echte Datenmengen, personenbezogene Spalten nach Regeln maskiert.",
      icon: EyeOffIcon,
      disabled: anonymizeBlocked
        ? "Benötigt pg_dump und psql mit \\restrict-Schutz (17.6 / 18 oder neuer)."
        : null,
    },
  ];
  const submit = () => {
    const request = {
      action: "branch" as const,
      source,
      name,
      kind,
      method: kind === "full" && !snapshot ? method : ("auto" as const),
      snapshot: snapshot || null,
      ttlHours: Number(ttl),
      protected: locked,
    };
    onClose();
    void workspace.job(
      `Branch „${name}“ anlegen`,
      (url) => branchingRun(url, request, workspace.toolPaths),
      name,
      (job) => {
        const used = METHOD_LABELS[String(job.result?.method ?? "")] ?? "";
        return `Branch „${name}“ angelegt${used ? ` (${used})` : ""}.`;
      },
    );
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="vcs-surface max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Branch erstellen</DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              Eine eigene, private Datenbank auf demselben Server. Nur du hast zunächst Zugriff.
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5 text-xs">
            <span className="font-medium">Name</span>
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value.trim())}
              aria-invalid={Boolean(nameError)}
              className="font-mono"
            />
            {nameError && <span className="text-destructive">{nameError}</span>}
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 text-xs">
              <span className="font-medium">Quelle</span>
              <VersioningSelect
                hideLabel
                label="Quelle"
                value={source}
                onChange={(value) => {
                  setSource(value);
                  setSnapshot("");
                }}
                options={sourceNames.map((value) => ({
                  value,
                  label: sources.some((entry) => entry.name === value)
                    ? value
                    : `${value} (gelöscht)`,
                }))}
              />
            </div>
            <div className="space-y-1.5 text-xs">
              <span className="font-medium">Stand</span>
              <VersioningSelect
                hideLabel
                label="Stand"
                value={snapshot}
                onChange={setSnapshot}
                options={[
                  ...(live ? [{ value: "", label: "Aktueller Stand" }] : []),
                  ...snapshots.map((entry) => ({
                    value: entry.id,
                    label: `${entry.label} · ${new Date(entry.createdAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}`,
                  })),
                ]}
              />
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-xs font-medium">Inhalt</legend>
            {kinds.map((option) => (
              <button
                key={option.id}
                ref={option.id === "anonymized" ? anonymizedFeature.ref : undefined}
                type="button"
                aria-pressed={kind === option.id}
                disabled={Boolean(option.disabled)}
                onClick={() => setKind(option.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors disabled:opacity-50",
                  kind === option.id ? "bg-primary/10" : "bg-muted/40 hover:bg-muted",
                )}
              >
                <option.icon
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    kind === option.id ? "text-primary" : "text-muted-foreground",
                  )}
                  strokeWidth={1.7}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    {option.title}
                    {option.id === "anonymized" && anonymizedFeature.isNew && <NewBadge />}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                    {option.disabled ?? option.detail}
                  </span>
                </span>
              </button>
            ))}
          </fieldset>
          {kind === "full" && !snapshot && (
            <div className="space-y-1.5 text-xs">
              <span className="font-medium">Kopierverfahren</span>
              <VersioningSelect
                hideLabel
                label="Kopierverfahren"
                value={method}
                onChange={(value) => setMethod(value as BranchMethod)}
                options={METHOD_OPTIONS}
              />
              {method !== "stream" && (sourceInfo?.sessions ?? 0) > 0 && (
                <span className="block text-[11px] text-muted-foreground">
                  „{source}“ hat {sourceInfo?.sessions} offene Verbindungen.{" "}
                  {method === "clone"
                    ? "Ein Sofort-Klon braucht eine unbenutzte Quelle."
                    : "Es wird automatisch der Datenstrom verwendet."}
                </span>
              )}
            </div>
          )}
          {kind === "anonymized" && (
            <div
              className={cn(
                "space-y-1.5 rounded-lg p-3 text-[11px] leading-relaxed",
                coverageOpen && !columns.isLoading
                  ? "bg-amber-500/5 text-amber-800 dark:text-amber-200"
                  : "bg-muted/40 text-muted-foreground",
              )}
            >
              {snapshot ? (
                <p>Die Regeln werden beim Anlegen gegen den Katalog der Sicherung geprüft.</p>
              ) : columns.isLoading ? (
                <p>Spalten werden auf personenbezogene Daten geprüft …</p>
              ) : columns.error ? (
                <p>{String(columns.error)}</p>
              ) : missing.length || invalid.length ? (
                <>
                  <p className="flex items-center gap-1.5 font-medium">
                    <CircleAlertIcon className="size-3.5" />
                    {missing.length
                      ? `${missing.length} personenbezogene Spalten ohne Regel`
                      : "Ungültige Regeln"}
                  </p>
                  <p className="font-mono">
                    {[
                      ...missing.slice(0, 6).map((column) => `${column.table}.${column.column}`),
                      ...invalid.slice(0, 4),
                    ].join(", ")}
                    {missing.length > 6 ? ` +${missing.length - 6}` : ""}
                  </p>
                  <Button type="button" size="sm" variant="outline" onClick={onPolicies}>
                    Regeln festlegen
                  </Button>
                </>
              ) : (
                <p className="flex items-center gap-1.5">
                  <CheckCircle2Icon className="size-3.5 text-emerald-600" />
                  {rules.length} Regeln decken alle erkannten personenbezogenen Spalten ab
                  {strict ? " (Teamregeln)" : ""}.
                </p>
              )}
            </div>
          )}
          <div className="grid items-end gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 text-xs">
              <span className="font-medium">Ablauf</span>
              <VersioningSelect
                hideLabel
                label="Ablauf"
                value={ttl}
                onChange={setTtl}
                options={ttlOptions}
              />
            </div>
            <label className="flex h-9 items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 text-xs">
              <span>Geschützt</span>
              <Switch checked={locked} onCheckedChange={setLocked} aria-label="Branch schützen" />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit" size="sm" disabled={!ready || overview.readOnly}>
              Branch erstellen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
