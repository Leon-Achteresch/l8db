import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SqlEditorPane } from "@/features/functions/function-view";
import { PACKAGE_TYPES, ROUTINE_TYPES } from "@/lib/versioning/blame";
import "@/index.css";

const host = window as unknown as { gitBlameSources: Record<string, string> };

function GitBlameFixture() {
  const [part, setPart] = useState<"routine" | "spec" | "body">("routine");
  const [editing, setEditing] = useState(false);
  const [sql, setSql] = useState<string | null>(null);
  const value = editing && sql !== null ? sql : host.gitBlameSources[part];
  return (
    <ThemeProvider attribute="class" defaultTheme="dark">
      <main className="flex h-dvh flex-col">
        <div className="flex gap-2 p-2">
          {(["routine", "spec", "body"] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => {
                setPart(entry);
                setEditing(false);
                setSql(null);
              }}
            >
              {entry}
            </button>
          ))}
          <button type="button" onClick={() => setEditing(true)}>
            Bearbeiten
          </button>
        </div>
        <SqlEditorPane
          blame={
            part === "routine"
              ? { schema: "public", name: "calc", types: ROUTINE_TYPES }
              : { schema: "public", name: "billing", types: PACKAGE_TYPES, part }
          }
          value={value}
          readOnly={!editing}
          onChange={editing ? setSql : undefined}
        />
      </main>
    </ThemeProvider>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<GitBlameFixture />);
