import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { tabLabel } from "@/lib/tab-navigation";
import { queryNeedsCloseConfirmation, tabKey, useTableTabs } from "@/lib/table-tabs";
import type { PendingClose } from "./use-tab-close";

interface CloseConfirmDialogProps {
  pendingClose: PendingClose;
  setPendingClose: (value: PendingClose) => void;
  savingClose: boolean;
  saveAndClose: () => Promise<void>;
  executeClose: (pending: NonNullable<PendingClose>) => void;
}

export function CloseConfirmDialog({
  pendingClose,
  setPendingClose,
  savingClose,
  saveAndClose,
  executeClose,
}: CloseConfirmDialogProps) {
  const tabs = useTableTabs((state) => state.tabs);
  const dirty = pendingClose
    ? tabs.filter(
        (tab) =>
          pendingClose.keys.includes(tabKey(tab)) &&
          tab.kind === "query" &&
          queryNeedsCloseConfirmation(tab),
      )
    : [];
  return (
    <AlertDialog
      open={pendingClose !== null}
      onOpenChange={(open) => {
        if (!open && !savingClose) setPendingClose(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ungespeicherte Änderungen</AlertDialogTitle>
          <AlertDialogDescription>
            {dirty.length === 1
              ? "Dieser Tab hat ungespeicherte Änderungen:"
              : `Diese ${dirty.length} Tabs haben ungespeicherte Änderungen:`}
          </AlertDialogDescription>
          <ul className="max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-sm">
            {dirty.slice(0, 10).map((tab) => (
              <li key={tabKey(tab)} className="truncate">
                {tabLabel(tab)}
              </li>
            ))}
            {dirty.length > 10 && (
              <li className="text-muted-foreground">und {dirty.length - 10} weitere</li>
            )}
          </ul>
          <p className="text-xs text-muted-foreground">
            Ohne Speichern geschlossene Tabs lassen sich über die Entwurfswiederherstellung
            zurückholen.
          </p>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={savingClose}>Abbrechen</AlertDialogCancel>
          <Button disabled={savingClose} onClick={() => void saveAndClose()}>
            {savingClose ? "Speichern…" : "Speichern und schließen"}
          </Button>
          <AlertDialogAction
            variant="destructive"
            disabled={savingClose}
            onClick={() => {
              if (!pendingClose) return;
              const pending = pendingClose;
              setPendingClose(null);
              executeClose(pending);
            }}
          >
            Ohne Speichern schließen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
