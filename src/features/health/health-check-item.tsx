import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, CopyIcon, SquareTerminalIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import type { HealthCheckResult } from "@/lib/db";
import { useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";
import { showCopiedMessage } from "@/lib/workspace-status";
import { CATEGORY_LABEL, GROUP_DOT, groupOf } from "./health-meta";

interface Props {
  check: HealthCheckResult;
}

export function HealthCheckItem({ check }: Props) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const openQueryTabWithSql = useTableTabs((s) => s.openQueryTabWithSql);
  const issue = check.status === "issue";

  const copy = async (sql: string) => {
    await copyText(sql);
    showCopiedMessage("SQL kopiert");
  };

  const openInEditor = (sql: string) => {
    const id = openQueryTabWithSql(sql, check.title);
    void navigate({ to: "/query/$id", params: { id } });
  };

  return (
    <div className={cn("rounded-lg transition-colors", open ? "bg-muted/40" : "hover:bg-muted/40")}>
      <button
        type="button"
        className="flex h-9 w-full cursor-pointer items-center gap-2.5 px-2 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <ChevronRightIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <span className={cn("size-1.5 shrink-0 rounded-full", GROUP_DOT[groupOf(check)])} />
        <span
          className={cn("min-w-0 flex-1 truncate text-[13px]", !issue && "text-muted-foreground")}
        >
          {check.title}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {CATEGORY_LABEL[check.category]}
        </span>
        <span className="w-6 shrink-0 text-right text-xs font-medium tabular-nums">
          {issue ? check.objects.length : ""}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 pr-3 pb-3 pl-[2.375rem] text-[13px]">
          <p className="text-muted-foreground">{check.explanation}</p>
          {check.status === "skipped" && (
            <p className="text-xs text-muted-foreground">Übersprungen: {check.skippedReason}</p>
          )}
          {check.objects.length > 0 && (
            <ul className="flex flex-col gap-1">
              {check.objects.map((object) => (
                <li key={`${object.name}|${object.detail ?? ""}`} className="flex flex-col gap-0.5">
                  <span className="break-all font-mono text-xs">{object.name}</span>
                  {object.detail && (
                    <span className="text-xs text-muted-foreground">{object.detail}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {check.fixSql && (
            <div className="flex flex-col gap-1.5">
              <pre className="max-h-60 overflow-auto rounded-lg bg-background/70 px-3 py-2 font-mono text-xs whitespace-pre">
                {check.fixSql}
              </pre>
              <div className="flex items-center gap-1">
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => openInEditor(check.fixSql ?? "")}
                >
                  <SquareTerminalIcon data-icon="inline-start" />
                  Im Editor öffnen
                </Button>
                <Button variant="ghost" size="xs" onClick={() => void copy(check.fixSql ?? "")}>
                  <CopyIcon data-icon="inline-start" />
                  Kopieren
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
