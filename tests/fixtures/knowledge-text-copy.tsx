import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AiKnowledgeDialog } from "@/features/ai/ai-knowledge-dialog";
import { AiPlusActions } from "@/features/ai/ai-plus-actions";
import "@/index.css";

const connections = {
  source: "Quelle",
  target: "Ziel",
  empty: "Ohne Fachtexte",
  error: "Lesefehler",
};
type ConnectionId = keyof typeof connections;

function KnowledgeFixture() {
  const [id, setId] = useState<ConnectionId>("source");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const switchConnection = (event: Event) => setId((event as CustomEvent<ConnectionId>).detail);
    window.addEventListener("fixture-knowledge-scope", switchConnection);
    return () => window.removeEventListener("fixture-knowledge-scope", switchConnection);
  }, []);

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <label className="flex items-center gap-2">
        Verbindung
        <select value={id} onChange={(event) => setId(event.target.value as ConnectionId)}>
          {Object.entries(connections).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <AiPlusActions
        connectionName={connections[id]}
        disabled={false}
        onAttach={() => {
          throw Error("Files are outside the fixture");
        }}
        onKnowledge={() => setOpen(true)}
      />
      <AiKnowledgeDialog
        connectionId={id}
        connectionName={connections[id]}
        open={open}
        onOpenChange={setOpen}
      />
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw Error("Missing fixture root");
createRoot(root).render(
  <ThemeProvider attribute="class" defaultTheme="system">
    <TooltipProvider>
      <KnowledgeFixture />
    </TooltipProvider>
  </ThemeProvider>,
);
