import {
  BookOpen,
  ChartColumn,
  Database,
  Eye,
  FileUp,
  Search,
  ShieldCheck,
  ShieldX,
  SquarePen,
  Terminal,
  Wrench,
} from "lucide-react";
import { parseAiDiff } from "@/lib/ai/diff";
import { parseAiTable } from "@/lib/ai/result";
import type { AiRichBlock } from "@/lib/ai/rich";
import { AiResultCard } from "./ai-result-card";
import { AiToolDetail } from "./ai-tool-detail";
import { AiWorkRow } from "./ai-work-row";
import { FileDiff } from "./beui/agents/file-diff";
import { ImageGeneration } from "./beui/agents/image-generation";
import { TodoList } from "./beui/agents/todo-list";

const TOOL_NAMES: Record<string, string> = {
  query: "Datenabfrage",
  visualize: "Diagramm",
  search: "Schemasuche",
  describe: "Tabellenansicht",
  connections: "Verbindungsliste",
  execute: "Datenänderung",
  dashboard: "Dashboard",
  benchmark: "Benchmark",
  knowledge: "KI-Wissen",
  import_file: "Dateiimport",
};

function toolIcon(name: string) {
  if (name === "visualize") return ChartColumn;
  if (name === "knowledge") return BookOpen;
  if (name === "import_file") return FileUp;
  if (/search|find|grep/i.test(name)) return Search;
  if (/query|sql|execute|benchmark/i.test(name)) return Database;
  if (/list|describe|read|get|schema|show/i.test(name)) return Eye;
  if (/bash|shell|command|exec|run/i.test(name)) return Terminal;
  if (/write|edit|patch|apply|create/i.test(name)) return SquarePen;
  return Wrench;
}

export function AiRichContent({
  blocks,
  running,
  showWork = true,
}: {
  blocks: AiRichBlock[];
  running: boolean;
  showWork?: boolean;
}) {
  return (
    <div className="space-y-1">
      {blocks.map((block) => {
        if (block.type === "tool") {
          const status = block.status === "running" && !running ? "cancelled" : block.status;
          if (block.name === "visualize" && status === "success" && parseAiTable(block.output))
            return <AiResultCard key={block.id} block={block} />;
          if (!showWork) return null;
          const name = TOOL_NAMES[block.name] ?? block.name;
          return (
            <AiWorkRow
              key={block.id}
              icon={toolIcon(block.name)}
              active={status === "running"}
              failed={status === "error"}
              label={
                status === "running"
                  ? `${name} läuft`
                  : status === "error"
                    ? `${name} fehlgeschlagen`
                    : status === "cancelled"
                      ? `${name} abgebrochen`
                      : `${name} ausgeführt`
              }
              detail={
                block.sql || parseAiTable(block.output) ? (
                  <AiToolDetail block={block} />
                ) : (
                  block.output || undefined
                )
              }
            />
          );
        }
        if (block.type === "decision")
          return showWork ? (
            <AiWorkRow
              key={block.id}
              icon={block.outcome === "denied" ? ShieldX : ShieldCheck}
              label={`${block.title} · ${
                block.outcome === "allowed"
                  ? "Einmal erlaubt"
                  : block.outcome === "denied"
                    ? "Abgelehnt"
                    : "Beantwortet"
              }`}
            />
          ) : null;
        if (block.type === "plan")
          return (
            <TodoList
              key={block.id}
              items={block.items}
              title="Plan des Agents"
              defaultOpen={false}
              collapseOnComplete
              className="py-1 text-xs"
            />
          );
        if (block.type === "diff")
          return (
            <FileDiff
              key={block.id}
              file={block.path}
              lines={parseAiDiff(block.diff, block.id)}
              copyText={block.diff}
              defaultOpen={false}
              maxHeight={280}
              status="complete"
              className="my-1"
            />
          );
        if (block.type === "image")
          return (
            <ImageGeneration
              key={block.id}
              label={block.label}
              status={block.status === "generating" && !running ? "error" : block.status}
              statusText={
                block.src
                  ? "Bild bereit"
                  : block.status === "error"
                    ? "Bildgenerierung fehlgeschlagen"
                    : "Bild-Ergebnis ohne Vorschau"
              }
              size="fluid"
              interactive={false}
              className="my-1 max-w-sm"
            >
              {block.src && (
                <img src={block.src} alt={block.label} className="h-full w-full object-contain" />
              )}
            </ImageGeneration>
          );
        return null;
      })}
    </div>
  );
}
