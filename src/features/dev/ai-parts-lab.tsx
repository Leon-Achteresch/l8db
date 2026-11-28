import { Brain } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AiBanner } from "@/features/ai/ai-banner";
import { AiFollowups } from "@/features/ai/ai-followups";
import { AiPanelHeader } from "@/features/ai/ai-panel-header";
import { AiRichContent } from "@/features/ai/ai-rich-content";
import { AiTurnHeader } from "@/features/ai/ai-turn-header";
import { AiWorkRow } from "@/features/ai/ai-work-row";
import { AiFigureContext } from "@/lib/ai/figures";
import {
  PART_CHARTS,
  PART_DECISIONS,
  PART_DIFF,
  PART_IMAGES,
  PART_ISSUES,
  PART_PLAN,
  PART_QUERY_RUNNING,
  PART_QUERY_STATES,
  PART_REASONING,
  PART_TOOLS,
} from "./ai-parts-lab-data";
import { AiPartsLabSpecimen as Specimen } from "./ai-parts-lab-specimen";

const noop = () => undefined;
const figures = {
  numbers: new Map(PART_CHARTS.map((block, index) => [block.id, index + 1])),
  shelf: false,
  focused: null,
  focus: noop,
};
const startedAt = Date.now() - 12_000;
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-4";

function header(view: "chat" | "settings" | "history", busy = false, minimizeNew = false) {
  return (
    <AiPanelHeader
      title="Umsatz der letzten 6 Monate"
      icon="chart-line"
      view={view}
      minimized={false}
      busy={busy}
      minimizeNew={minimizeNew}
      minimizeRef={noop}
      onBack={noop}
      onNew={noop}
      onHistory={noop}
      onSettings={noop}
      onFullPage={noop}
      onMinimize={noop}
      onRestore={noop}
      onClose={noop}
    />
  );
}

const SECTIONS: { id: string; title: string; parts: [string, ReactNode][] }[] = [
  {
    id: "header",
    title: "Kopfzeile",
    parts: [
      ["Gespräch", header("chat")],
      ["Gespräch · KI arbeitet", header("chat", true)],
      ["Gespräch · neue Funktion im Menü", header("chat", false, true)],
      ["Verlauf", header("history")],
      ["Einstellungen", header("settings")],
    ],
  },
  {
    id: "turn",
    title: "Lauf",
    parts: [
      ["Arbeitet", <AiTurnHeader key="a" streaming startedAt={startedAt} steps={0} />],
      [
        "Fertig, eingeklappt",
        <AiTurnHeader key="b" streaming={false} durationMs={8400} steps={4} onToggle={noop} />,
      ],
      [
        "Fertig, aufgeklappt",
        <AiTurnHeader key="c" streaming={false} durationMs={8400} steps={4} open onToggle={noop} />,
      ],
      ["Gestoppt", <AiTurnHeader key="d" streaming={false} stopped durationMs={5200} steps={2} />],
    ],
  },
  {
    id: "thinking",
    title: "Denken",
    parts: [
      ["Denkt nach", <AiWorkRow key="a" icon={Brain} active label="Denkt nach" />],
      [
        "Gedacht, eingeklappt",
        <AiWorkRow
          key="b"
          icon={Brain}
          tone="lead"
          label="Ich suche zuerst die Bestelltabelle"
          detail={PART_REASONING}
        />,
      ],
      [
        "Gedacht, aufgeklappt",
        <AiWorkRow
          key="c"
          icon={Brain}
          tone="lead"
          label="Ich suche zuerst die Bestelltabelle"
          detail={PART_REASONING}
          open
          onToggle={noop}
        />,
      ],
    ],
  },
  {
    id: "states",
    title: "Zustände eines Tool-Aufrufs",
    parts: [
      ["Läuft", <AiRichContent key="a" blocks={[PART_QUERY_RUNNING]} running />],
      [
        "Fertig mit SQL und Tabelle · Fertig als Text · Fehler · Abgebrochen",
        <AiRichContent key="b" blocks={PART_QUERY_STATES} running={false} />,
      ],
    ],
  },
  {
    id: "tools",
    title: "Alle Tool-Aufrufe",
    parts: [
      [
        `${PART_TOOLS.length} Tools inkl. MCP und unbekanntem Tool`,
        <AiRichContent key="a" blocks={PART_TOOLS} running={false} />,
      ],
    ],
  },
  {
    id: "decisions",
    title: "Freigaben und Plan",
    parts: [
      [
        "Erlaubt · Abgelehnt · Beantwortet",
        <AiRichContent key="a" blocks={PART_DECISIONS} running={false} />,
      ],
      ["Plan", <AiRichContent key="b" blocks={[PART_PLAN]} running />],
    ],
  },
  {
    id: "artifacts",
    title: "Änderungen, Bilder, Issues",
    parts: [
      ["Diff", <AiRichContent key="a" blocks={[PART_DIFF]} running={false} />],
      ["Bild: erzeugt · fertig · Fehler", <AiRichContent key="b" blocks={PART_IMAGES} running />],
      ["Issue: läuft · erstellt · Fehler", <AiRichContent key="c" blocks={PART_ISSUES} running />],
    ],
  },
  {
    id: "charts",
    title: "Ergebnisse",
    parts: PART_CHARTS.map((block) => [
      block.chart?.chart ?? "",
      <AiRichContent key={block.id} blocks={[block]} running={false} />,
    ]),
  },
  {
    id: "hints",
    title: "Hinweise und Folgefragen",
    parts: [
      [
        "Einrichtung",
        <AiBanner
          key="a"
          tone="setup"
          action={
            <Button size="xs" variant="secondary">
              Einrichten
            </Button>
          }
        >
          Claude Code ist nicht eingerichtet.
        </AiBanner>,
      ],
      [
        "Fehler",
        <AiBanner key="b" tone="error" onClose={noop}>
          AI-Daten konnten nicht lokal gespeichert werden.
        </AiBanner>,
      ],
      [
        "Folgefragen",
        <AiFollowups
          key="c"
          questions={["Welche Produkte treiben das Wachstum?", "Vergleich mit dem Vorjahr"]}
          onAsk={noop}
        />,
      ],
    ],
  },
];

export function AiPartsLab() {
  return (
    <AiFigureContext value={figures}>
      <div className="space-y-10">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">KI-Bausteine</h2>
          <p className="text-sm text-muted-foreground">
            Jeder Baustein einzeln, in allen Zuständen.
          </p>
        </div>
        {SECTIONS.map((section) => (
          <section
            key={section.id}
            data-ai-part={section.id}
            aria-labelledby={`ai-part-${section.id}`}
            className="space-y-3 rounded-2xl bg-muted/40 p-4"
          >
            <h3 id={`ai-part-${section.id}`} className="px-1 text-sm font-semibold">
              {section.title}
            </h3>
            <div className={GRID}>
              {section.parts.map(([label, node]) => (
                <Specimen key={label} label={label} wide={section.id === "tools"}>
                  {node}
                </Specimen>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AiFigureContext>
  );
}
