import { Check, ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import { RecommendationCard } from "@/components/primitives/recommendation-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AiAnswer } from "@/features/ai/ai-answer";

export function AiLabApproval() {
  const [decision, setDecision] = useState<"allowed" | "denied" | null>(null);
  const [unknown, setUnknown] = useState(false);

  return (
    <section aria-label="Freigabevorschau" className="h-full overflow-auto px-5 py-8 sm:px-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="ml-auto w-fit rounded-xl rounded-br-sm border bg-muted/40 px-4 py-3 text-sm">
          Markiere die inaktiven Testkunden als archiviert.
        </div>
        <div className="flex items-center justify-between gap-3">
          <Badge variant="outline" className="gap-1.5">
            <ShieldAlert className="size-3" /> Staging · Daten ändern
          </Badge>
          <Button size="xs" variant="ghost" onClick={() => setUnknown(!unknown)}>
            {unknown ? "Probelauf zeigen" : "Ohne Probelauf testen"}
          </Button>
        </div>
        {decision ? (
          <div role="status" className="space-y-4 rounded-xl border bg-card p-6">
            <div className="flex items-center gap-2 font-medium">
              {decision === "allowed" ? (
                <Check className="size-4 text-primary" />
              ) : (
                <X className="size-4 text-muted-foreground" />
              )}
              {decision === "allowed"
                ? "Änderung in der Vorschau freigegeben"
                : "Änderung abgelehnt"}
            </div>
            <p className="text-sm text-muted-foreground">
              Es wurden keine Daten verändert. Diese Entscheidung gilt nur für die Vorschau.
            </p>
            <Button size="sm" variant="outline" onClick={() => setDecision(null)}>
              Freigabe erneut ausprobieren
            </Button>
          </div>
        ) : (
          <RecommendationCard
            title={
              <span className="text-xl font-semibold tracking-tight">
                {unknown ? "Testkunden archivieren" : "3 Testkunden archivieren"}
              </span>
            }
            meta={
              <>
                <ShieldAlert className="size-3.5 text-amber-500" />
                <span>Einmalige Freigabe</span>
              </>
            }
            details={
              <p className="text-xs leading-6">
                PostgreSQL · Shop · public.customers
                <br />
                {unknown
                  ? "Kein erfolgreicher Probelauf verfügbar. Die betroffene Zeilenzahl ist unbekannt."
                  : "Der Probelauf wurde zurückgerollt. Die tatsächlich betroffene Zeilenzahl kann sich bis zur Ausführung ändern."}
              </p>
            }
            detailsLabel="Probelauf-Details"
            className="border-amber-500/30"
            actions={
              <>
                <Button size="xs" variant="ghost" onClick={() => setDecision("denied")}>
                  Ablehnen
                </Button>
                <Button size="xs" onClick={() => setDecision("allowed")}>
                  {unknown ? "Änderung freigeben" : "3 Zeilen ändern"}
                </Button>
              </>
            }
          >
            <p>Shop · public.customers · UPDATE</p>
            <div className="my-4 grid gap-3 sm:grid-cols-3">
              {[
                { label: "Betroffene Zeilen", value: unknown ? "Unbekannt" : "3" },
                { label: "Probelauf", value: unknown ? "Nicht verfügbar" : "Zurückgerollt" },
                { label: "Schreibumfang", value: "Mit WHERE-Filter" },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border bg-background p-3">
                  <p className="text-[10px] text-muted-foreground">{item.label}</p>
                  <p className="mt-2 text-base font-semibold text-foreground">{item.value}</p>
                </div>
              ))}
            </div>
            <AiAnswer
              streaming={false}
              text={
                "```sql\nUPDATE public.customers\nSET archived = true\nWHERE is_test = true AND active = false;\n```"
              }
            />
            <p className="mt-4 rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-6 text-foreground/80">
              {unknown
                ? "Die Auswirkung ist unbekannt. Ohne erfolgreichen Probelauf keine genaue Zeilenzahl versprechen."
                : "3 betroffene Zeilen im simulierten Probelauf. Keine gespeicherte Änderung und kein dauerhafter Rückweg vorbereitet."}
            </p>
          </RecommendationCard>
        )}
        <p className="text-xs leading-6 text-muted-foreground">
          Ziel, Umgebung, SQL und Auswirkung stehen direkt an der Entscheidung. Die Gesprächseingabe
          pausiert, bis die Freigabe beantwortet ist.
        </p>
      </div>
    </section>
  );
}
