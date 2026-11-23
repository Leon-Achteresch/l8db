import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { CopyIcon, FileDownIcon, FileTextIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyText } from "@/lib/clipboard";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import {
  exportSchemaReport,
  type ReportExportState,
  schemaReportIssue,
} from "@/lib/schema-compare/report-export";
import type { SyncScript } from "@/lib/schema-compare/script";

export function SchemaCompareReportActions({
  state,
  getCurrent,
  script,
}: {
  state: ReportExportState;
  getCurrent: () => ReportExportState;
  script: SyncScript;
}) {
  const [busy, setBusy] = useState(false);
  const feature = useNewFeatureVisibility<HTMLButtonElement>("schema-compare.report");
  const issue = schemaReportIssue(state);
  const run = async (action: "copy" | "save") => {
    setBusy(true);
    try {
      const outcome = await exportSchemaReport(action, state, getCurrent, script, {
        choosePath: (defaultPath) =>
          save({ defaultPath, filters: [{ name: "Markdown-Bericht", extensions: ["md"] }] }),
        write: writeTextFile,
        copy: (text) => copyText(text, "Schemaänderungsbericht kopiert"),
      });
      if (outcome === "saved") toast.success("Schemaänderungsbericht gespeichert");
    } catch (error) {
      toast.error(`Bericht nicht exportiert: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={busy || Boolean(issue)}>
        <Button
          ref={feature.ref}
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={busy || Boolean(issue)}
          disabledReason={issue ?? "Bericht wird exportiert"}
          aria-label="Schemaänderungsbericht"
        >
          <FileTextIcon className="size-3.5" />
          Bericht
          {feature.isNew && <NewBadge />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void run("copy")}>
          <CopyIcon className="size-3.5" />
          Bericht kopieren
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void run("save")}>
          <FileDownIcon className="size-3.5" />
          Bericht speichern…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
