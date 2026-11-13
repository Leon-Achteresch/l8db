import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { CommandPalette } from "../../src/components/motion/command-palette";
import { SharedTabDialog } from "../../src/features/shell/table-tabs/shared-tab-dialog";
import { listenForSharedTabLinks } from "../../src/lib/shared-tab-paste";
import { type SharedTab, sharedTabLink } from "../../src/lib/shared-tabs";
import "../../src/index.css";

const calls: string[] = [];
Object.assign(window, {
  __calls: calls,
  __TAURI_INTERNALS__: {
    invoke: async (command: string) => {
      calls.push(command);
      return [];
    },
  },
});

const tab: SharedTab = {
  v: 1,
  connection: { name: "Shop", kind: "postgres", host: "db.firma.de", port: "5432" },
  database: "shop",
  kind: "table",
  schema: "public",
  table: "orders",
  entityType: "table",
  view: {},
};
sharedTabLink(tab).then((l8dbLink) => Object.assign(window, { l8dbLink }));

function Harness() {
  useEffect(listenForSharedTabLinks, []);
  const palette = new URLSearchParams(window.location.search).has("palette");
  return (
    <main>
      <input id="field" aria-label="Feld" />
      <div
        id="editor"
        role="textbox"
        contentEditable
        suppressContentEditableWarning
        aria-label="Editor"
      >
        Text
      </div>
      <p id="page">Seite</p>
      {palette && <CommandPalette items={[]} open onOpenChange={() => {}} />}
      <SharedTabDialog />
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Harness />);
