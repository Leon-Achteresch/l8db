import { useQuery } from "@tanstack/react-query";
import { EyeOffIcon } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { IGNORE_PATH, parseIgnore, validateIgnore } from "@/lib/versioning/ignore";
import { encode, readFile, saveFile } from "@/lib/versioning/repository";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningPopover } from "./versioning-popover";

export function VersioningIgnoreSettings({
  workspace,
  onSaved,
}: {
  workspace: VersioningWorkspace;
  onSaved: () => void;
}) {
  const { repo, status, run } = workspace;
  const feature = useNewFeatureVisibility<HTMLParagraphElement>("versioning.ignore");
  const [text, setText] = useState<string | null>(null);
  const file = useQuery({
    queryKey: ["versioning-ignore", repo, status?.head, status?.changes],
    enabled: Boolean(repo && status),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const raw = await readFile(repo, IGNORE_PATH);
      try {
        return { raw, patterns: parseIgnore(raw).patterns, problem: null };
      } catch (error) {
        const patterns = (() => {
          try {
            const value = JSON.parse(raw ?? "") as { patterns?: unknown };
            return Array.isArray(value.patterns) ? value.patterns.map(String) : [];
          } catch {
            return [];
          }
        })();
        return { raw, patterns, problem: String(error).replace(/^Error: /, "") };
      }
    },
  });
  const value = text ?? (file.data?.patterns ?? []).join("\n");
  const save = () =>
    void run(async () => {
      const patterns = [
        ...new Set(
          value
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
        ),
      ];
      await saveFile(
        repo,
        IGNORE_PATH,
        encode(validateIgnore({ format: 1, patterns })),
        file.data?.raw ?? null,
      );
      setText(null);
      await workspace.refresh();
      onSaved();
    }, "Ausschlussliste gespeichert");
  return (
    <VersioningPopover icon={EyeOffIcon} label="Ausgeschlossene Objekte" className="w-96">
      <p ref={feature.ref} className="text-[11px] leading-relaxed text-muted-foreground">
        Objekte, die hier passen, liest die Prüfung nicht und schlägt sie nicht zur Aufnahme vor.
        Bereits verwaltete Objekte bleiben versioniert. Ein Muster pro Zeile, optional mit Typ.
        {feature.isNew && <NewBadge />}
      </p>
      {(file.error || file.data?.problem) && (
        <p className="text-[11px] text-destructive">
          {file.data?.problem
            ? `${file.data.problem} Die Liste wird bis zur Korrektur nicht angewendet.`
            : String(file.error)}
        </p>
      )}
      <Textarea
        aria-label="Ausschlussmuster, eines pro Zeile"
        placeholder={"view:V_EXP_*\nTMP_*\nroutine:DBG_*"}
        value={value}
        onChange={(event) => setText(event.target.value)}
        className="min-h-32 font-mono text-[11px]"
      />
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        <span className="font-mono">*</span> steht für beliebige Zeichen,{" "}
        <span className="font-mono">?</span> für genau eines. Typen: table, view, materialized_view,
        routine, procedure, package, sequence. Gespeichert in{" "}
        <span className="font-mono">{IGNORE_PATH}</span> und mit dem nächsten Commit geteilt.
      </p>
      <Button size="sm" disabled={text === null} onClick={save}>
        Speichern
      </Button>
    </VersioningPopover>
  );
}
