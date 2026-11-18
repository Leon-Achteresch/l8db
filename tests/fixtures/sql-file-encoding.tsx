import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { useRef } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import type { QueryEditorApi } from "@/features/query/query-editor-pane";
import { ExternalChangeBanner } from "@/features/query/query-view/external-change-banner";
import { QueryFileEncodingDialog } from "@/features/query/query-view/query-file-encoding-dialog";
import { QueryToolsMenu } from "@/features/query/query-view/query-tools-menu";
import { useQueryFileActions } from "@/features/query/query-view/use-query-file-actions";
import { useQueryTabSql } from "@/features/query/query-view/use-query-tab-state";
import { useTableTabs } from "@/lib/table-tabs";
import "@/index.css";

const noop = () => {};

function QueryFixture({ tabId }: { tabId: string }) {
  const editorApiRef = useRef<QueryEditorApi | null>(null);
  const tab = useQueryTabSql(tabId);
  const file = useQueryFileActions(tabId, tab.filePath);
  return (
    <main className="flex h-dvh flex-col gap-3 p-3">
      <div className="flex justify-end">
        <QueryToolsMenu
          editorApiRef={editorApiRef}
          shortcutLabel={() => ""}
          hasSql={Boolean(tab.sql)}
          isSql
          connected={false}
          serverOutput={false}
          bookmarkCount={0}
          filePath={tab.filePath}
          fileBusy={file.fileBusy}
          fileRequiresUtf8Copy={tab.fileRequiresUtf8Copy}
          isRunning={false}
          onOpenHistory={noop}
          onOpenOutput={noop}
          onOpenSave={noop}
          onOpenSnippets={noop}
          onOpenTabSearch={noop}
          onClearBookmarks={noop}
          onFileOpen={() => void file.handleFileOpen()}
          onChooseFileEncoding={file.setEncodingAction}
          onFileSave={(saveAs) => void file.handleFileSave(saveAs)}
          onClearEditor={noop}
        />
      </div>
      {file.encodingAction && (
        <QueryFileEncodingDialog
          action={file.encodingAction}
          dirty={tab.fileDirty}
          initial={file.encodingAction === "reload" ? tab.fileReadEncoding : "auto"}
          onClose={() => file.setEncodingAction(null)}
          onRead={file.applyEncoding}
        />
      )}
      {tab.externalChange && (
        <ExternalChangeBanner
          fileDirty={tab.fileDirty}
          fileBusy={file.fileBusy}
          onReload={() => void file.reloadFromFile()}
          onKeepLocal={() => void file.keepLocal()}
        />
      )}
      <label htmlFor="sql">SQL</label>
      <textarea
        id="sql"
        className="min-h-0 flex-1 resize-none rounded-md bg-muted/40 p-3 font-mono text-xs"
        value={tab.sql}
        onChange={(event) => tab.updateQuerySql(tabId, event.target.value)}
      />
      <output aria-label="Dateibindung">{tab.filePath ?? ""}</output>
      <Toaster />
    </main>
  );
}

const initial = useTableTabs.getState().openQueryTab();
const root = createRootRoute({ component: Outlet });
const query = createRoute({
  getParentRoute: () => root,
  path: "/query/$id",
  component: () => {
    const { id } = query.useParams();
    return <QueryFixture key={id} tabId={id} />;
  },
});
const router = createRouter({
  routeTree: root.addChildren([query]),
  history: createMemoryHistory({ initialEntries: [`/query/${initial}`] }),
});
const host = document.getElementById("root");
if (host)
  createRoot(host).render(
    <ThemeProvider attribute="class" defaultTheme="system">
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
