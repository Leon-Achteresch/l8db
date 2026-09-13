import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type AnalysisWorkspace,
  saveAnalysisWorkspace,
  useAnalysisWorkspaces,
} from "@/lib/analysis-workspaces";
import { useConnectionsStore } from "@/lib/connections";

export function AnalysisWorkspaceBar({
  value,
  onLoad,
}: {
  value: Omit<AnalysisWorkspace, "id" | "name">;
  onLoad: (value: AnalysisWorkspace) => void;
}) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const workspaces = useAnalysisWorkspaces((state) => state.workspaces);
  const connections = useConnectionsStore((state) => state.connections);
  const load = () => {
    const workspace = workspaces.find((entry) => entry.id === selected);
    if (!workspace) return;
    const sides =
      workspace.tab === "data"
        ? [workspace.dataLeft, workspace.dataRight]
        : [workspace.left, workspace.right];
    if (
      sides.some(
        (side) =>
          side.connectionId &&
          !connections.some((connection) => connection.id === side.connectionId),
      )
    ) {
      toast.error("Eine gespeicherte Verbindung existiert nicht mehr.");
      return;
    }
    onLoad(workspace);
    setName(workspace.name);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
      <select
        aria-label="Analyse-Arbeitsstand"
        className="h-8 max-w-64 rounded border bg-background px-2 text-xs"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
      >
        <option value="">Arbeitsstand auswählen</option>
        {workspaces.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </select>
      <Button size="sm" variant="outline" disabled={!selected} onClick={load}>
        Laden
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={!selected}
        onClick={() => {
          useAnalysisWorkspaces.setState((state) => ({
            workspaces: state.workspaces.filter((entry) => entry.id !== selected),
          }));
          setSelected("");
        }}
      >
        Entfernen
      </Button>
      <Input
        className="h-8 w-48"
        aria-label="Name des Arbeitsstands"
        placeholder="Name des Arbeitsstands"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button
        size="sm"
        disabled={!name.trim()}
        onClick={() => {
          saveAnalysisWorkspace({ ...value, name });
          toast.success("Analyse-Arbeitsstand gespeichert");
        }}
      >
        Speichern
      </Button>
    </div>
  );
}
