import { Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { forgetEditorKnowledge } from "@/lib/ai/editor/context";
import { type AiKnowledge, aiKnowledgeGet, aiKnowledgeSet } from "@/lib/db/ai";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { AiDataRules } from "./ai-data-rules";
import { AiKnowledgeTable } from "./ai-knowledge-table";

const EMPTY: AiKnowledge = { notes: "", glossary: [], tables: {} };

interface KnowledgeDraft {
  connectionId: string;
  knowledge: AiKnowledge;
}

export function AiKnowledgeDialog({
  connectionId,
  connectionName,
  open,
  onOpenChange,
  onGenerate,
  onDiscoverRules,
}: {
  connectionId: string;
  connectionName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate?: () => void;
  onDiscoverRules?: () => void;
}) {
  const [loadedDraft, setDraft] = useState<KnowledgeDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [failedConnectionId, setFailedConnectionId] = useState<string | null>(null);
  const [removedRules, setRemovedRules] = useState<string[]>([]);
  const request = useRef<AbortController | null>(null);
  const draft = open && loadedDraft?.connectionId === connectionId ? loadedDraft : null;
  const knowledge = draft?.knowledge ?? EMPTY;
  const setKnowledge = (next: AiKnowledge) => {
    if (draft && !saving) setDraft({ connectionId, knowledge: next });
  };
  const rulesFeature = useNewFeatureVisibility<HTMLElement>(
    open ? "ai.chat.plus.knowledge.rules" : undefined,
  );
  const copyFeature = useNewFeatureVisibility<HTMLParagraphElement>(
    draft ? "ai.chat.plus.knowledge.copy-text" : undefined,
  );
  useEffect(() => {
    setDraft(null);
    setSaving(false);
    setFailedConnectionId(null);
    setRemovedRules([]);
    if (!open) return;
    const scope = new AbortController();
    request.current = scope;
    void aiKnowledgeGet(connectionId)
      .then((value) => {
        if (!scope.signal.aborted) setDraft({ connectionId, knowledge: value });
      })
      .catch((error) => {
        if (scope.signal.aborted) return;
        setFailedConnectionId(connectionId);
        toast.error(String(error));
      });
    return () => scope.abort();
  }, [open, connectionId]);
  const tables = Object.entries(knowledge.tables);
  const setTable = (table: string, change: Partial<AiKnowledge["tables"][string]>) =>
    setKnowledge({
      ...knowledge,
      tables: { ...knowledge.tables, [table]: { ...knowledge.tables[table], ...change } },
    });
  const setTerm = (index: number, change: Partial<AiKnowledge["glossary"][number]>) =>
    setKnowledge({
      ...knowledge,
      glossary: knowledge.glossary.map((entry, position) =>
        position === index ? { ...entry, ...change } : entry,
      ),
    });
  const store = async () => {
    const scope = request.current;
    if (!draft || saving || !scope || scope.signal.aborted) return;
    setSaving(true);
    try {
      const latest = await aiKnowledgeGet(connectionId);
      if (scope.signal.aborted) return;
      const invariants = (latest.invariants ?? []).filter(
        (rule) => !removedRules.includes(rule.name),
      );
      await aiKnowledgeSet(connectionId, { ...knowledge, invariants });
      forgetEditorKnowledge(connectionId);
      if (scope.signal.aborted) return;
      toast.success("KI-Wissen gespeichert");
      onOpenChange(false);
    } catch (error) {
      if (!scope.signal.aborted) toast.error(String(error));
    } finally {
      if (!scope.signal.aborted) setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] gap-4 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>KI-Wissen über {connectionName}</DialogTitle>
          <DialogDescription>
            Die KI liest diese Beschreibungen und Begriffe in jedem Gespräch über diese Verbindung.
            Gute Beschreibungen machen Antworten deutlich genauer.
          </DialogDescription>
        </DialogHeader>
        {onGenerate && (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3 text-xs">
            <Sparkles className="size-4 shrink-0 text-primary" />
            <p className="flex-1">
              Die KI kann alle Tabellen ansehen und Beschreibungen selbst erzeugen. Du kannst sie
              danach hier prüfen und anpassen.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onGenerate();
                onOpenChange(false);
              }}
            >
              Mit KI erzeugen
            </Button>
          </div>
        )}
        <section ref={rulesFeature.ref} className="space-y-2" aria-label="Regeln">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            Regeln
            {rulesFeature.isNew && <NewBadge />}
          </h3>
          <Textarea
            aria-label="Regeln"
            placeholder="Verbindliche Vorgaben für Chat und Editor-KI, z. B. „Immer LIMIT 100 setzen“, „Keine SELECT *“ oder „Gelöschte Zeilen über deleted_at ausfiltern“."
            value={knowledge.rules ?? ""}
            rows={3}
            maxLength={8000}
            onChange={(event) => setKnowledge({ ...knowledge, rules: event.target.value })}
          />
        </section>
        <AiDataRules
          open={open}
          rules={knowledge.invariants ?? []}
          onRemove={(name) => {
            setRemovedRules([...removedRules, name]);
            setKnowledge({
              ...knowledge,
              invariants: (knowledge.invariants ?? []).filter((rule) => rule.name !== name),
            });
          }}
          onDiscover={
            onDiscoverRules
              ? () => {
                  onDiscoverRules();
                  onOpenChange(false);
                }
              : undefined
          }
        />
        <section className="space-y-2" aria-label="Begriffe">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Begriffe</h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setKnowledge({
                  ...knowledge,
                  glossary: [...knowledge.glossary, { term: "", meaning: "" }],
                })
              }
            >
              <Plus className="size-3.5" />
              Begriff
            </Button>
          </div>
          {!knowledge.glossary.length && (
            <p className="text-xs text-muted-foreground">
              Zum Beispiel „Umsatz = Summe von orders.total ohne Stornos“ oder „aktive Kunden =
              Bestellung in den letzten 90 Tagen“.
            </p>
          )}
          {knowledge.glossary.map((entry, index) => (
            <div key={String(index)} className="flex items-start gap-2">
              <Input
                aria-label="Begriff"
                placeholder="Begriff"
                value={entry.term}
                className="w-40 shrink-0"
                onChange={(event) => setTerm(index, { term: event.target.value })}
              />
              <Input
                aria-label="Bedeutung"
                placeholder="Bedeutung oder Berechnung"
                value={entry.meaning}
                onChange={(event) => setTerm(index, { meaning: event.target.value })}
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label={`${entry.term || "Begriff"} entfernen`}
                onClick={() =>
                  setKnowledge({
                    ...knowledge,
                    glossary: knowledge.glossary.filter((_, position) => position !== index),
                  })
                }
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </section>
        <section className="space-y-2" aria-label="Tabellen">
          <h3 className="text-sm font-medium">Tabellen</h3>
          {!tables.length ? (
            <p className="text-xs text-muted-foreground">
              {failedConnectionId === connectionId
                ? "Das KI-Wissen konnte nicht geladen werden."
                : draft
                  ? "Noch keine Beschreibungen. Lass sie von der KI erzeugen oder bitte die KI im Chat, sich etwas zu merken."
                  : "Wird geladen …"}
            </p>
          ) : (
            <p
              ref={copyFeature.ref}
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <span>
                Einzelne Texte kopieren und in der anderen Verbindung ins passende Feld einfügen.
              </span>
              {copyFeature.isNew && <NewBadge />}
            </p>
          )}
          {tables.map(([table, note]) => (
            <AiKnowledgeTable
              key={table}
              table={table}
              note={note}
              disabled={saving}
              onChange={(change) => setTable(table, change)}
              onRemove={() => {
                const { [table]: _, ...rest } = knowledge.tables;
                setKnowledge({ ...knowledge, tables: rest });
              }}
            />
          ))}
        </section>
        <section className="space-y-2" aria-label="Notizen">
          <h3 className="text-sm font-medium">Notizen</h3>
          <Textarea
            aria-label="Notizen"
            placeholder="Was die KI sonst wissen sollte, z. B. Zeitzone, Geschäftsjahr oder welche Daten Testdaten sind."
            value={knowledge.notes}
            rows={3}
            onChange={(event) => setKnowledge({ ...knowledge, notes: event.target.value })}
          />
        </section>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button disabled={!draft || saving} onClick={() => void store()}>
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
