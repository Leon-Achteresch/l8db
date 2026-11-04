import { Paperclip, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { type AiAccessLevel, AiAccessStrip } from "@/features/ai/ai-access-strip";
import { AiContextChips } from "@/features/ai/ai-context-chips";
import { PromptInput } from "@/features/ai/beui/agents/prompt-input";
import { AI_LAB_CONTEXT } from "./ai-lab-data";

export function AiLabComposer({
  running,
  onSend,
  onStop,
}: {
  running: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState("codex");
  const [level, setLevel] = useState<AiAccessLevel>("read");
  const [context, setContext] = useState(AI_LAB_CONTEXT.slice(0, 2));
  const [attachment, setAttachment] = useState(false);

  return (
    <div className="shrink-0 space-y-2 border-t bg-background px-4 pt-3 pb-3 sm:px-6">
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <AiAccessStrip
          level={level}
          production={false}
          connectionLabel="Shop"
          connections={
            <div className="space-y-3 p-4 text-xs">
              <p className="font-medium">Kontext dieses Gesprächs</p>
              <p className="text-muted-foreground">Shop · PostgreSQL · public</p>
              <AiContextChips
                items={context}
                onRemove={(id) => setContext(context.filter((item) => item.id !== id))}
              />
              <Button size="xs" variant="outline" onClick={() => setContext(AI_LAB_CONTEXT)}>
                Editor hinzufügen
              </Button>
            </div>
          }
          onLevel={setLevel}
          disabled={running}
          approval={
            <span className="flex items-center gap-1.5 px-2 text-[11px]">
              <ShieldCheck className="size-3.5" /> Änderungen fragen
            </span>
          }
          trailing={<span className="pr-1 text-[10px] tabular-nums">18 %</span>}
        />
        <PromptInput
          value={draft}
          onValueChange={setDraft}
          maxLength={2000}
          aria-label="Nachricht in der KI-Vorschau"
          placeholder="Frage zu deinen Daten oder @Kontext …"
          models={[
            { value: "codex", label: "Codex" },
            { value: "claude", label: "Claude" },
            { value: "local", label: "Lokales Modell" },
          ]}
          model={model}
          onModelChange={setModel}
          loading={running}
          onStop={onStop}
          minRows={2}
          onSubmit={(text) => {
            onSend(text);
            setDraft("");
          }}
          leadingAction={
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Beispieldatei anhängen"
              onClick={() => setAttachment(!attachment)}
            >
              <Paperclip className="size-3.5" />
            </Button>
          }
          className="rounded-none border-0 bg-transparent focus-within:border-0"
        />
        {attachment && (
          <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
            umsatz-oktober.csv · Beispieldatei{" "}
            <button type="button" className="ml-2 underline" onClick={() => setAttachment(false)}>
              Entfernen
            </button>
          </p>
        )}
      </div>
      <p className="flex justify-between gap-3 text-[10px] text-muted-foreground">
        <span>Vorschau · keine Datenübertragung</span>
        <span>Enter senden · Shift+Enter neue Zeile</span>
      </p>
    </div>
  );
}
