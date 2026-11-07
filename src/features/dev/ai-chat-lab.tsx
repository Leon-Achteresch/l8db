import { Button } from "@/components/ui/button";
import { AiBanner } from "@/features/ai/ai-banner";
import { AiIssueCard } from "@/features/ai/ai-issue-card";
import { AiPanelTabs } from "@/features/ai/ai-panel-tabs";
import { AiResultsShelf } from "@/features/ai/ai-results-shelf";
import { AiTranscript } from "@/features/ai/ai-transcript";
import { AiFigureContext } from "@/lib/ai/figures";
import { aiFigures } from "@/lib/ai/result";
import { AiChatLabComposer } from "./ai-chat-lab-composer";
import {
  LAB_APPROVAL,
  LAB_DECISIONS,
  LAB_DONE,
  LAB_ERROR,
  LAB_FOLLOWUP,
  LAB_FORM,
  LAB_ISSUE,
  LAB_MULTI,
  LAB_QUESTION,
  LAB_QUESTIONS,
  LAB_RUN_QUESTION,
  LAB_RUNNING,
  LAB_STOPPED,
  LAB_TABLE,
  LAB_THINKING,
} from "./ai-chat-lab-data";
import { AiChatLabFrame } from "./ai-chat-lab-frame";

const noop = () => undefined;
const conversation = [LAB_QUESTION, LAB_DONE, LAB_FOLLOWUP, LAB_TABLE];
const figures = {
  numbers: new Map([
    ["t3", 1],
    ["t4", 2],
  ]),
  shelf: false,
  focused: null,
  focus: noop,
};

function transcript(messages: typeof conversation, runId: string | null = null, status = "") {
  return (
    <AiTranscript
      messages={messages}
      runId={runId}
      runStatus={status}
      onEdit={noop}
      onRetry={noop}
      onBranch={noop}
      onAsk={noop}
    />
  );
}

export function AiChatLab() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">KI-Chat: alle Zustände</h2>
        <p className="text-sm text-muted-foreground">
          Echte Chat-Komponenten mit Beispieldaten. Klicks lösen keine KI-Aktionen aus.
        </p>
      </div>
      <AiFigureContext value={figures}>
        <div className="flex flex-wrap items-start gap-x-8 gap-y-10">
          <AiChatLabFrame id="start" title="1 · Start" hint="Leeres Gespräch mit Vorschlägen">
            <AiChatLabComposer empty />
          </AiChatLabFrame>
          <AiChatLabFrame
            id="input"
            title="2 · Eingabe"
            hint="@-Erwähnung, Kontext, Anhang, Warteschlange"
          >
            <div className="flex-1" />
            <AiChatLabComposer chips mentions queue level="write" prompt="Vergleiche mit @cus" />
          </AiChatLabFrame>
          <AiChatLabFrame
            id="answer"
            title="3 · Antwort"
            hint="Arbeitsschritte, Diagramm, Tabelle, Folgefragen"
            heading="Umsatz der letzten 6 Monate"
            height={1640}
          >
            <AiPanelTabs tab="chat" count={2} onTab={noop} />
            {transcript(conversation)}
            <AiChatLabComposer />
          </AiChatLabFrame>
          <AiChatLabFrame
            id="running"
            title="4 · Arbeitet"
            hint="Plan, laufender Schritt, Streaming"
          >
            {transcript([LAB_RUN_QUESTION, LAB_RUNNING], "lab", "Ursachenanalyse")}
            <AiChatLabComposer busy />
          </AiChatLabFrame>
          <AiChatLabFrame
            id="thinking"
            title="5 · Denkt nach"
            hint="Erster Moment nach dem Senden"
            height={460}
          >
            {transcript([LAB_RUN_QUESTION, LAB_THINKING], "lab", "Startet …")}
            <AiChatLabComposer busy />
          </AiChatLabFrame>
          <AiChatLabFrame
            id="approval"
            title="6 · Freigabe"
            hint="KI will Daten ändern"
            height={760}
          >
            {transcript([LAB_RUN_QUESTION], "lab", "Wartet auf deine Freigabe")}
            <AiChatLabComposer approvals={[LAB_APPROVAL]} level="write" production busy />
          </AiChatLabFrame>
          <AiChatLabFrame
            id="question"
            title="7 · Rückfrage"
            hint="Auswahl mit mehreren Schritten"
            height={640}
          >
            <div className="flex-1" />
            <AiChatLabComposer approvals={[LAB_QUESTIONS]} busy />
          </AiChatLabFrame>
          <AiChatLabFrame
            id="multi"
            title="8 · Mehrfachauswahl"
            hint="Mehrere Antworten möglich"
            height={600}
          >
            <div className="flex-1" />
            <AiChatLabComposer approvals={[LAB_MULTI]} busy />
          </AiChatLabFrame>
          <AiChatLabFrame
            id="form"
            title="9 · Formular"
            hint="KI braucht strukturierte Angaben"
            height={640}
          >
            <div className="flex-1" />
            <AiChatLabComposer approvals={[LAB_FORM]} busy />
          </AiChatLabFrame>
          <AiChatLabFrame
            id="issue"
            title="10 · Issue"
            hint="Entwurf, erstellt, fehlgeschlagen"
            height={760}
          >
            <div className="min-h-0 flex-1 space-y-1 overflow-auto px-6 pt-5">
              <AiIssueCard
                title={LAB_ISSUE.title}
                body={LAB_ISSUE.body}
                status="success"
                url="https://github.com/Leon-Achteresch/l8db/issues/412"
              />
              <AiIssueCard
                title={LAB_ISSUE.title}
                body={LAB_ISSUE.body}
                status="error"
                error="Dienst nicht erreichbar."
              />
            </div>
            <AiChatLabComposer
              approvals={[
                {
                  kind: "approval",
                  data: {
                    id: "issue",
                    title: "GitHub-Issue erstellen",
                    details: { tool: "report_issue", ...LAB_ISSUE },
                  },
                },
              ]}
              busy
            />
          </AiChatLabFrame>
          <AiChatLabFrame
            id="problems"
            title="11 · Probleme"
            hint="Entscheidungen, Fehler, gestoppt, Setup"
            height={1320}
          >
            <AiBanner
              tone="setup"
              action={
                <Button size="xs" variant="secondary">
                  Einrichten
                </Button>
              }
            >
              Claude Code ist nicht eingerichtet.
            </AiBanner>
            {transcript([
              LAB_RUN_QUESTION,
              LAB_DECISIONS,
              LAB_FOLLOWUP,
              LAB_STOPPED,
              LAB_QUESTION,
              LAB_ERROR,
            ])}
            <AiChatLabComposer />
            <AiBanner tone="error" onClose={noop}>
              AI-Daten konnten nicht lokal gespeichert werden.
            </AiBanner>
          </AiChatLabFrame>
          <AiChatLabFrame
            id="results"
            title="12 · Ergebnisse"
            hint="Gesammelte Diagramme und Tabellen"
            height={1000}
          >
            <AiPanelTabs tab="results" count={2} onTab={noop} />
            <AiResultsShelf figures={aiFigures(conversation)} />
          </AiChatLabFrame>
        </div>
      </AiFigureContext>
    </div>
  );
}
