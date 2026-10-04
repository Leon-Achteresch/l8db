import { useNavigate } from "@tanstack/react-router";
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleSlashIcon,
  CopyIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import type { HealthCheckResult } from "@/lib/db";
import { useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";
import { CATEGORY_LABEL, SEVERITY_CLASS, SEVERITY_LABEL } from "./health-meta";

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
    toast.success("SQL kopiert");
  };

  const openInEditor = (sql: string) => {
    const id = openQueryTabWithSql(sql, check.title);
    void navigate({ to: "/query/$id", params: { id } });
  };

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <ChevronRightIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        {issue && check.severity ? (
          <Badge variant="outline" className={cn("shrink-0", SEVERITY_CLASS[check.severity])}>
            {SEVERITY_LABEL[check.severity]}
          </Badge>
        ) : check.status === "skipped" ? (
          <CircleSlashIcon className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <CheckCircle2Icon className="size-4 shrink-0 text-emerald-500" />
        )}
        <span className={cn("min-w-0 flex-1 truncate text-sm", !issue && "text-muted-foreground")}>
          {check.title}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {CATEGORY_LABEL[check.category]}
        </span>
        {issue && (
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {check.objects.length}
          </Badge>
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t px-3 py-3 text-sm">
          <p className="text-muted-foreground">{check.explanation}</p>
          {check.status === "skipped" && (
            <p className="text-xs text-muted-foreground">Übersprungen: {check.skippedReason}</p>
          )}
          {check.status === "ok" && (
            <p className="text-xs text-emerald-600">Keine Auffälligkeiten.</p>
          )}
          {check.objects.length > 0 && (
            <ul className="flex flex-col divide-y rounded-md border">
              {check.objects.map((object) => (
                <li
                  key={`${object.name}|${object.detail ?? ""}`}
                  className="flex flex-col gap-0.5 px-2.5 py-1.5"
                >
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
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">Vorgeschlagene Behebung</span>
                <span className="flex-1" />
                <Button variant="ghost" size="xs" onClick={() => void copy(check.fixSql ?? "")}>
                  <CopyIcon data-icon="inline-start" />
                  Kopieren
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => openInEditor(check.fixSql ?? "")}
                >
                  <SquareTerminalIcon data-icon="inline-start" />
                  Im Editor öffnen
                </Button>
              </div>
              <pre className="max-h-60 overflow-auto rounded-md bg-muted px-2.5 py-2 font-mono text-xs whitespace-pre">
                {check.fixSql}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
