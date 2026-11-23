import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryView } from "@/features/query/query-view";
import { useConnectionsStore } from "@/lib/connections";
import type {
  CoreServices,
  ExtensionArchive,
  ExtensionStorage,
  InstalledExtension,
} from "@/lib/extensions/contracts";
import { ExtensionManager } from "@/lib/extensions/manager";
import { ExtensionHostContext } from "@/lib/extensions/react-context";
import { SandboxRuntime } from "@/lib/extensions/sandbox-runtime";
import { monaco } from "@/lib/monaco";
import { useProvidersStore } from "@/lib/providers";
import { useQueryWorkspace } from "@/lib/query-workspace";
import { useTableTabs } from "@/lib/table-tabs";
import "@/index.css";

const EXTENSION = "fixture.logs";
const COMMAND = "fixture.logs.toggle";
const SOURCE = [
  "SELECT id, saldo FROM konto WHERE id = 42;",
  "PRINT 'debug: konto gelesen';",
  "SELECT name FROM kunde WHERE id = 7;",
  "PRINT CONCAT('debug: kunde ',",
  "  'gelesen');",
  "SELECT 1 AS fertig;",
].join("\n");
const CODE = `exports.activate = (context, api) => {
  const active = new Set();
  const hide = async (editorId) => {
    const { text, version } = await api.editor.getText(editorId);
    const lines = text.split("\\n");
    const ranges = [];
    for (let index = 0; index < lines.length; index++) {
      if (!/^\\s*PRINT\\b/i.test(lines[index])) continue;
      let end = index;
      while (end < lines.length - 1 && !lines[end].includes(";")) end++;
      ranges.push({ startLine: index + 1, endLine: end + 1 });
      index = end;
    }
    try {
      await api.editor.setHiddenRanges(editorId, version, ranges);
    } catch (error) {
      if (!String(error).includes("StaleEditorVersionError")) throw error;
    }
  };
  context.subscriptions.push(api.commands.registerCommand("${COMMAND}", async ({ editorId }) => {
    const on = !active.delete(editorId);
    if (on) {
      active.add(editorId);
      await hide(editorId);
    } else await api.editor.clearHiddenRanges(editorId);
    await api.commands.setChecked("${COMMAND}", editorId, on);
  }));
  context.subscriptions.push(api.editor.onDidChangeText(({ editorId }) => {
    if (active.has(editorId)) return hide(editorId);
  }));
};`;
const archive: ExtensionArchive = {
  format: 1,
  manifest: {
    id: EXTENSION,
    publisher: "fixture",
    name: "Logs ausblenden",
    version: "1.0.0",
    engines: { l8db: ">=0.1.0 <2.0.0", api: "^1.2.0" },
    main: "extension.js",
    activationEvents: [`onCommand:${COMMAND}`],
    permissions: ["editor:read"],
    contributes: {
      commands: [{ id: COMMAND, title: "Logs ausblenden", icon: "eye-off" }],
      menus: [{ command: COMMAND, location: "editor/toolbar" }],
    },
  },
  files: { "extension.js": CODE },
};

useProvidersStore.setState({ loaded: true });
useConnectionsStore.setState({
  activeId: "fixture",
  connections: [
    {
      id: "fixture",
      name: "Fixture",
      kind: "mssql",
      connectionString: "mssql://127.0.0.1/fixture",
      sslMode: "disable",
      editorMetadataPrefetch: false,
    },
  ],
});
useQueryWorkspace.getState().update({ navigatorVisible: false, runTarget: "all" });
const tabs = useTableTabs.getState();
const first = tabs.openQueryTab();
const second = tabs.openQueryTab();
tabs.updateQuerySql(first, SOURCE);
tabs.updateQuerySql(second, "SELECT 2 AS zweiter_tab;");

const records = new Map<string, InstalledExtension>();
const manager = new ExtensionManager(
  {
    list: async () => [...records.values()],
    install: async (value: ExtensionArchive) => {
      records.set(value.manifest.id, {
        archive: value,
        enabled: false,
        grants: [],
        configuration: {},
      });
    },
    update: async (id: string, enabled: boolean, grants: InstalledExtension["grants"]) => {
      Object.assign(records.get(id) ?? {}, { enabled, grants });
    },
    remove: async (id: string) => {
      records.delete(id);
    },
  } as unknown as ExtensionStorage,
  new SandboxRuntime(),
  { database: () => null } as unknown as CoreServices,
  "0.7.0",
);
const editorIds: string[] = [];
const register = manager.editors.register.bind(manager.editors);
manager.editors.register = (id, source) => {
  editorIds.push(id);
  return register(id, source);
};

function editor() {
  const found = monaco.editor
    .getEditors()
    .find((item) => item.getDomNode()?.closest("[data-fixture-query]"));
  if (!found) throw Error("Fixture editor is not mounted");
  return found;
}

function percentiles(durations: number[]) {
  const sorted = [...durations].sort((left, right) => left - right);
  return {
    runs: sorted.length,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}

let selectTab: (tabId: string) => void;
Object.assign(window, {
  extensionEditorFixture: {
    source: SOURCE,
    ready: manager
      .installExtension(archive)
      .then(() => manager.enableExtension(EXTENSION, ["editor:read"])),
    read: () => editor().getValue(),
    visible: () =>
      [...document.querySelectorAll("[data-fixture-query] .view-lines .view-line")]
        .map((line) => (line.textContent ?? "").replaceAll(" ", " "))
        .join("\n"),
    hidden: () => manager.editors.hiddenRanges(editorIds.at(-1) ?? ""),
    checked: () => manager.editors.isChecked(editorIds.at(-1) ?? "", COMMAND),
    openEditors: () => manager.editors.size(),
    type: (text: string) => {
      const target = editor();
      target.setPosition({ lineNumber: 1, column: 1 });
      target.executeEdits("fixture", [{ range: new monaco.Range(1, 1, 1, 1), text }]);
    },
    moveTo: (line: number) => editor().setPosition({ lineNumber: line, column: 1 }),
    copy: () => {
      const target = editor();
      const model = target.getModel();
      return model ? model.getValueInRange(model.getFullModelRange()) : "";
    },
    switchTab: (index: number) => selectTab(index ? second : first),
    disable: () => manager.disableExtension(EXTENSION),
    perf: (lines: number, count: number) => {
      const target = editor();
      const id = editorIds.at(-1) ?? "";
      target.setValue(
        Array.from({ length: lines }, (_, index) =>
          index % 3 === 1 ? `PRINT 'schritt ${index}';` : `SELECT ${index} AS wert;`,
        ).join("\n"),
      );
      const ranges = Array.from({ length: count }, (_, index) => ({
        startLine: index * 3 + 2,
        endLine: index * 3 + 2,
      }));
      const hide: number[] = [];
      const typing: number[] = [];
      for (let run = 0; run < 23; run++) {
        const { version } = manager.editors.read(id);
        let started = performance.now();
        manager.editors.setHidden("perf", id, version, ranges);
        if (run > 1) hide.push(performance.now() - started);
        started = performance.now();
        target.executeEdits("perf", [{ range: new monaco.Range(1, 1, 1, 1), text: "x" }]);
        if (run > 1) typing.push(performance.now() - started);
      }
      manager.editors.clear("perf");
      return {
        lines,
        ranges: count,
        setHiddenRanges: percentiles(hide),
        typing: percentiles(typing),
      };
    },
  },
});

function Fixture() {
  const [tab, setTab] = useState(first);
  selectTab = setTab;
  return (
    <div data-fixture-query className="flex h-dvh min-h-0 flex-col">
      <QueryView tabId={tab} />
    </div>
  );
}

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
const route = createRootRoute({ component: Fixture });
const router = createRouter({ routeTree: route, history: createMemoryHistory() });
const root = document.getElementById("root");
if (!root) throw Error("Missing fixture root");
createRoot(root).render(
  <ExtensionHostContext.Provider value={manager}>
    <ThemeProvider attribute="class" defaultTheme="system">
      <TooltipProvider>
        <HotkeysProvider>
          <QueryClientProvider client={client}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </HotkeysProvider>
      </TooltipProvider>
    </ThemeProvider>
  </ExtensionHostContext.Provider>,
);
