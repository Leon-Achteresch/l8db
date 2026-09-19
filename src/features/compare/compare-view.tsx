import { useNavigate, useSearch } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { DefinitionCompareView } from "@/features/compare/definition-compare-view";
import { EMPTY_COMPARE_SIDE } from "@/lib/compare-types";
import { useActiveConnection } from "@/lib/connections";
import {
  databaseFromConnectionString,
  useActiveDatabase,
  useActiveSchema,
} from "@/lib/db-selection";
import { useTableTabs } from "@/lib/table-tabs";
import type { CompareWorkspace } from "@/lib/table-tabs/types";

export function CompareView({ tabId }: { tabId?: string } = {}) {
  const search = useSearch({ strict: false }) as { compareId?: string };
  const fallbackId = useRef(crypto.randomUUID());
  const id = tabId ?? search.compareId ?? fallbackId.current;
  const navigate = useNavigate();
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  const tab = useTableTabs((state) =>
    state.tabs.find((item) => item.kind === "tool" && item.tool === "compare" && item.id === id),
  );
  const initial = useRef<CompareWorkspace>({
    left: {
      ...EMPTY_COMPARE_SIDE,
      connectionId: connection?.id ?? null,
      database:
        database ?? (connection ? databaseFromConnectionString(connection.connectionString) : null),
      schema,
    },
    right: EMPTY_COMPARE_SIDE,
    draft: null,
    onlyDifferences: false,
  });
  const workspace = tab?.kind === "tool" && tab.compare ? tab.compare : initial.current;
  const update = (patch: Partial<CompareWorkspace>) => {
    const current = useTableTabs
      .getState()
      .tabs.find((item) => item.kind === "tool" && item.tool === "compare" && item.id === id);
    const next = {
      ...workspace,
      ...(current?.kind === "tool" ? current.compare : undefined),
      ...patch,
    };
    const name = next.left.objectName?.trim().replace(/\s+/g, "_");
    useTableTabs
      .getState()
      .updateCompareTab(id, next, name ? `Vergleich ${name}` : "Neuer Vergleich");
  };

  useEffect(() => {
    useTableTabs.getState().openToolTab("compare", id);
    if (!tabId && !search.compareId)
      void navigate({ to: "/compare", search: { compareId: id }, replace: true });
  }, [id, tabId, search.compareId, navigate]);

  useEffect(() => {
    if (tab?.kind === "tool" && !tab.compare)
      useTableTabs.getState().updateCompareTab(id, initial.current, "Neuer Vergleich");
  }, [id, tab]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b px-3 py-1">
        <span className="text-xs text-muted-foreground">
          Zielentwurf · automatisch gespeichert · Ausführung nach Bestätigung
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const nextId = crypto.randomUUID();
            useTableTabs.getState().openToolTab("compare", nextId);
            void navigate({ to: "/compare", search: { compareId: nextId } });
          }}
        >
          <PlusIcon className="size-3.5" />
          Neuer Vergleich
        </Button>
      </div>
      <DefinitionCompareView
        key={id}
        mode="definitions"
        sourceConnection={connection}
        left={workspace.left}
        right={workspace.right}
        onLeftChange={(left) =>
          update({
            left,
            ...(left.objectType !== workspace.right.objectType ||
            left.objectName !== workspace.left.objectName
              ? {
                  right: {
                    ...workspace.right,
                    objectType: left.objectType,
                    objectName: null,
                    objectOid: null,
                  },
                  draft: null,
                  draftBase: null,
                }
              : {}),
          })
        }
        onRightChange={(right) => update({ right, draft: null, draftBase: null })}
        draft={workspace.draft}
        draftBase={workspace.draftBase ?? null}
        onDraftChange={(draft, baseline) =>
          update({ draft, draftBase: workspace.draftBase ?? baseline })
        }
        onApplied={() => update({ draft: null, draftBase: null })}
        onlyDifferences={workspace.onlyDifferences}
        onOnlyDifferencesChange={(onlyDifferences) => update({ onlyDifferences })}
      />
    </div>
  );
}
