import { AnimatePresence, MotionConfig } from "motion/react";
import { useLayoutEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ChangeSurface } from "@/components/motion/change-surface";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TransactionPanel } from "@/features/shell/transaction-panel";
import { animateChange } from "@/lib/change-animation";
import { useTransactionStore } from "@/lib/transactions";
import "@/index.css";

declare global {
  interface Window {
    workspaceMotion: {
      change: () => void;
      redraw: () => void;
      play: () => () => void;
      panel: (open: boolean) => void;
      unmount: () => void;
      section: (element: HTMLElement) => () => void;
    };
  }
}

const root = createRoot(document.getElementById("root")!);

function WorkspaceMotionFixture() {
  const [revision, setRevision] = useState(0);
  const [redraw, setRedraw] = useState(0);
  const [panel, setPanel] = useState(false);
  const rows = useMemo(
    () =>
      Array.from({ length: 400 }, (_, row) => (
        <tr key={row} className="h-8 border-b border-border/40">
          {Array.from({ length: 24 }, (_, column) => (
            <td key={column} className="min-w-24 px-3 tabular-nums">
              {column === 0 ? row + 1 : `Wert ${row * 24 + column}`}
            </td>
          ))}
        </tr>
      )),
    [],
  );

  useLayoutEffect(() => {
    window.workspaceMotion = {
      change: () => flushSync(() => setRevision((value) => value + 1)),
      redraw: () => flushSync(() => setRedraw((value) => value + 1)),
      play: () => animateChange(document.querySelector("[data-slot=change-surface]")!),
      panel: (open) => flushSync(() => setPanel(open)),
      unmount: () => root.unmount(),
      section: (element) => animateChange(element, "section"),
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <main className="flex h-dvh flex-col bg-background text-foreground" data-redraw={redraw}>
        <header className="flex flex-wrap items-center gap-3 border-b px-6 py-4">
          <h1 className="mr-auto text-sm font-semibold">l8db · Arbeitsbereich</h1>
          <Button onClick={() => setRevision((value) => value + 1)}>Ansicht wechseln</Button>
          <Button variant="outline" onClick={() => setPanel((value) => !value)}>
            Transaktionen
          </Button>
        </header>
        <div className="relative flex min-h-0 flex-1">
          <aside className="flex w-52 shrink-0 flex-col gap-4 bg-sidebar p-5">
            <h2 className="text-xs font-medium">Darstellung</h2>
            <div className="flex items-center justify-between text-xs">
              Datenbank-Themes <Switch aria-label="Datenbank-Themes" />
            </div>
            <div className="flex items-center justify-between text-xs">
              Zeile auswählen <Checkbox aria-label="Zeile auswählen" />
            </div>
            <Input aria-label="Entwurf" defaultValue="SELECT * FROM kunden;" />
          </aside>
          <ChangeSurface
            changeKey={String(revision + 1)}
            className="flex min-h-0 min-w-0 flex-1 flex-col p-5"
          >
            <Tabs defaultValue="data" className="flex min-h-0 flex-1 flex-col">
              <TabsList className="w-fit">
                <TabsTrigger value="data">Daten</TabsTrigger>
                <TabsTrigger value="structure">Struktur</TabsTrigger>
              </TabsList>
              <TabsContent value="data" className="min-h-0 overflow-auto">
                <table className="w-full text-xs">
                  <tbody>{rows}</tbody>
                </table>
              </TabsContent>
              <TabsContent value="structure">24 Spalten · 400 Zeilen</TabsContent>
            </Tabs>
          </ChangeSurface>
          <AnimatePresence initial={false}>
            {panel && <TransactionPanel key="transactions" />}
          </AnimatePresence>
        </div>
      </main>
    </MotionConfig>
  );
}

useTransactionStore.setState({ transactions: [], panelOpen: false });
root.render(<WorkspaceMotionFixture />);
