import { AlertTriangleIcon, GaugeIcon, LoaderIcon, TimerIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export interface QueryAnalysisProps {
  section: "plan" | "perf";
  onSectionChange: (section: "plan" | "perf") => void;
  explainEnabled: boolean;
  onExplain: (analyze: boolean) => void;
  planLoading: boolean;
  planError: string | null;
  onPlanErrorDismiss: () => void;
  plan: ReactNode;
  perf: ReactNode;
}

export function QueryAnalysisSheet({
  open,
  onOpenChange,
  section,
  onSectionChange,
  explainEnabled,
  onExplain,
  planLoading,
  planError,
  onPlanErrorDismiss,
  plan,
  perf,
}: QueryAnalysisProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(100vw-1rem,520px)] gap-0 sm:max-w-[520px]">
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="text-sm">Analyse</SheetTitle>
          <p className="text-xs text-muted-foreground">
            Ausführungsplan und Laufzeitmessung der aktuellen Abfrage.
          </p>
        </SheetHeader>
        <ButtonGroup
          aria-label="Analyse ausführen"
          className="shrink-0 px-4 pt-4 [&>button]:flex-1 [&>button]:text-xs"
        >
          <Button
            size="sm"
            variant="outline"
            disabled={!explainEnabled || planLoading}
            onClick={() => onExplain(false)}
            title="Ausführungsplan anzeigen (führt nichts aus)"
          >
            {planLoading ? (
              <LoaderIcon className="size-3.5 animate-spin" />
            ) : (
              <GaugeIcon className="size-3.5" />
            )}
            Explain
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!explainEnabled || planLoading}
            onClick={() => onExplain(true)}
            title="Achtung: führt die Query wirklich aus und misst sie"
          >
            <GaugeIcon className="size-3.5" />
            Explain Analyze
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!explainEnabled}
            onClick={() => onSectionChange("perf")}
            title="Laufzeit mehrfach messen und Läufe vergleichen"
          >
            <TimerIcon className="size-3.5" />
            Performance
          </Button>
        </ButtonGroup>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {planError && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
              <p className="min-w-0 flex-1 text-xs break-words text-destructive">{planError}</p>
              <Button
                size="sm"
                variant="ghost"
                className="h-5 shrink-0 px-1.5 text-[10px]"
                onClick={onPlanErrorDismiss}
              >
                <XIcon className="size-3" />
              </Button>
            </div>
          )}
          <Accordion
            type="single"
            collapsible
            value={section}
            onValueChange={(value) => onSectionChange(value === "perf" ? "perf" : "plan")}
            className="mt-3 gap-0"
          >
            <AccordionItem value="plan" className="border-b-0">
              <AccordionTrigger className="py-2.5 text-xs">
                Ausführungsplan
                {plan ? (
                  <Badge variant="secondary" className="ml-2">
                    aktiv
                  </Badge>
                ) : null}
              </AccordionTrigger>
              <AccordionContent className="pb-2">
                <div className="flex min-h-0 flex-col gap-2">{plan}</div>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="perf" className="border-b-0">
              <AccordionTrigger className="py-2.5 text-xs">Performance-Test</AccordionTrigger>
              <AccordionContent className="pb-2">
                <div className="flex min-h-0 flex-col gap-2">{perf}</div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          {!plan && section === "plan" && (
            <p className="px-1 py-3 text-xs text-muted-foreground">
              Noch kein Plan geladen. „Explain“ erzeugt einen Plan, ohne die Abfrage auszuführen.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
