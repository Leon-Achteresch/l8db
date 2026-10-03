import {
  Database,
  Eye,
  Search,
  ShieldCheck,
  ShieldX,
  SquarePen,
  Terminal,
  Wrench,
} from "lucide-react";
import { parseAiDiff } from "@/lib/ai/diff";
import type { AiRichBlock } from "@/lib/ai/rich";
import { AiWorkRow } from "./ai-work-row";
import { FileDiff } from "./beui/agents/file-diff";
import { ImageGeneration } from "./beui/agents/image-generation";
import { TodoList } from "./beui/agents/todo-list";

function toolIcon(name: string) {
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
          if (!showWork) return null;
          const status = block.status === "running" && !running ? "cancelled" : block.status;
          return (
            <AiWorkRow
              key={block.id}
              icon={toolIcon(block.name)}
              active={status === "running"}
              failed={status === "error"}
              label={
                status === "running"
                  ? `Führt ${block.name} aus`
                  : status === "error"
                    ? `${block.name} fehlgeschlagen`
                    : status === "cancelled"
                      ? `${block.name} abgebrochen`
                      : `${block.name} ausgeführt`
              }
              detail={block.output || undefined}
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
