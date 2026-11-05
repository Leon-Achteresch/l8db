import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { diffLines } from "@/lib/ai/editor/line-diff";
import { isMainWindow } from "@/lib/connections";
import {
  finishUiPluginProposal,
  pendingUiPluginProposals,
  startUiPluginProposals,
  type UiPluginProposal,
} from "@/lib/db/ui-plugins";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useOrganizationStore } from "@/lib/organization-state";
import { checkUiPluginSource, reloadUiPlugins } from "@/lib/ui-plugins/host";
import { waitForProposalStatus } from "@/lib/ui-plugins/proposal-status";

export function PluginProposals() {
  const [proposals, setProposals] = useState<(UiPluginProposal & { http: string[] })[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const feature = useNewFeatureVisibility<HTMLDivElement>("ai.chat.ui-plugins");
  useEffect(() => {
    if (!isMainWindow || useOrganizationStore.getState().policy?.allowExtensions === false) return;
    let live = true;
    let running = false;
    let again = false;
    const sync = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        do {
          again = false;
          const pending = await pendingUiPluginProposals();
          const valid = [];
          for (const request of pending) {
            try {
              const definition =
                request.action === "write"
                  ? await checkUiPluginSource(request.name, request.source)
                  : null;
              valid.push({ ...request, http: definition?.http ?? [] });
            } catch (failure) {
              await finishUiPluginProposal(request, {
                decision: "invalid",
                message: String(failure),
              }).catch(() => undefined);
            }
          }
          if (live) setProposals(valid);
        } while (live && again);
      } finally {
        running = false;
      }
    };
    const unlisten = listen("ui-plugin-proposals", () => {
      void sync().catch(() => undefined);
    });
    void unlisten
      .then(() => startUiPluginProposals())
      .then(sync)
      .catch(() => undefined);
    return () => {
      live = false;
      void unlisten.then((stop) => stop());
    };
  }, []);
  const request = proposals[0];
  if (!request) return null;
  const decide = async (accept: boolean) => {
    setBusy(true);
    setError("");
    try {
      if (accept) {
        if (request.action === "write") await checkUiPluginSource(request.name, request.source);
        await finishUiPluginProposal(request, {}, true);
        await reloadUiPlugins();
        await finishUiPluginProposal(request, {
          decision: "accepted",
          status: (await waitForProposalStatus(request.name)) ?? {
            state: request.action === "remove" ? "removed" : "stale",
          },
        });
      } else await finishUiPluginProposal(request, { decision: "rejected" });
      setProposals((items) => items.filter((item) => item.nonce !== request.nonce));
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) void decide(false);
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-auto">
        <DialogTitle>
          UI-Plugin {request.action === "remove" ? "löschen" : "übernehmen"}: {request.name}
        </DialogTitle>
        <div ref={feature.ref} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Code und Beschreibungen stammen von der KI. HTTP-Freigaben bleiben unverändert.
          </p>
          {request.http.length > 0 && (
            <p className="text-sm">HTTP angefordert: {request.http.join(", ")}</p>
          )}
          {request.before !== null && (
            <details open>
              <summary>Bisheriger Code</summary>
              <pre className="max-h-48 overflow-auto bg-muted/40 p-3 text-xs">{request.before}</pre>
            </details>
          )}
          {request.before !== null && request.action === "write" && (
            <pre className="max-h-48 overflow-auto bg-muted/40 p-3 text-xs">
              {diffLines(request.before, request.source, { maxCells: 100_000 })
                .map((h) =>
                  [
                    ...h.oldLines.map((line) => `- ${line}`),
                    ...h.newLines.map((line) => `+ ${line}`),
                  ].join("\n"),
                )
                .join("\n")}
            </pre>
          )}
          {request.action === "write" && (
            <details open>
              <summary>Neuer Code</summary>
              <pre className="max-h-72 overflow-auto bg-muted/40 p-3 text-xs">{request.source}</pre>
            </details>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => void decide(false)}>
              Ablehnen
            </Button>
            <Button disabled={busy} onClick={() => void decide(true)}>
              Übernehmen
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
