import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Copy, ExternalLink, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { copyText } from "@/lib/clipboard";
import { collectSystemInfo, recentDiagnosticErrors } from "@/lib/diagnostics";

const ISSUES_URL = "https://github.com/Leon-Achteresch/l8db/issues/new";
const MAIL_TO = "leon.achteresch@gmail.com";

export async function collectDiagnosticText(): Promise<string> {
  const version = await getVersion().catch(() => "unbekannt");
  const system = collectSystemInfo();
  const errors = recentDiagnosticErrors().slice(0, 5);
  const lines = [
    `l8db: ${version}`,
    `OS: ${system.os || "unbekannt"} (${system.platform || "?"})`,
    `Sprache: ${system.language} · Zeitzone: ${system.timezone}`,
    `Fenster: ${window.innerWidth}x${window.innerHeight}`,
  ];
  if (errors.length > 0) {
    lines.push("", "Letzte Fehler:");
    for (const e of errors) lines.push(`- [${e.at}] ${e.source}: ${e.message}`);
  }
  return lines.join("\n");
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BugReportDialog({ open, onOpenChange }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [diagnostics, setDiagnostics] = useState("");

  useEffect(() => {
    if (!open) return;
    void collectDiagnosticText().then(setDiagnostics);
  }, [open]);

  const body = [
    "### Beschreibung",
    description.trim() || "_(keine Angabe)_",
    "",
    "### Schritte zum Reproduzieren",
    steps.trim() || "_(keine Angabe)_",
    "",
    "### Umgebung",
    "```",
    diagnostics,
    "```",
  ].join("\n");

  const canSend = description.trim().length > 0 && diagnostics.length > 0;

  async function copyReport() {
    try {
      await copyText(`# ${title || "l8db Bugreport"}\n\n${body}`);
      toast.success("Bugreport in die Zwischenablage kopiert");
    } catch {
      toast.error("Kopieren fehlgeschlagen");
    }
  }

  async function openGithub() {
    const params = new URLSearchParams({ title: title || "Bug: ", body, labels: "bug" });
    try {
      await openUrl(`${ISSUES_URL}?${params}`);
      onOpenChange(false);
    } catch {
      await copyReport();
      toast.info("Browser konnte nicht geöffnet werden, Report wurde kopiert");
    }
  }

  async function openMail() {
    const params = new URLSearchParams({ subject: title || "l8db Bugreport", body });
    try {
      await openUrl(`mailto:${MAIL_TO}?${params.toString().replace(/\+/g, "%20")}`);
      onOpenChange(false);
    } catch {
      await copyReport();
      toast.info("E-Mail-Programm nicht verfügbar, Report wurde kopiert");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] gap-4 overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bug melden</DialogTitle>
          <DialogDescription>
            Beschreibe kurz das Problem. Die Umgebungsdaten werden automatisch angehängt, ohne
            Passwörter oder Verbindungsdaten.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-w-0 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="bug-title">Titel</Label>
            <Input
              id="bug-title"
              placeholder="z. B. Query-Editor friert bei großen Ergebnissen ein"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bug-description">Was ist passiert?</Label>
            <Textarea
              id="bug-description"
              rows={4}
              placeholder="Was hast du erwartet, was ist stattdessen passiert?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bug-steps">Schritte zum Reproduzieren (optional)</Label>
            <Textarea
              id="bug-steps"
              rows={3}
              placeholder={"1. …\n2. …"}
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
            />
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Angehängte Umgebungsdaten</summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px] break-words whitespace-pre-wrap text-foreground">
              {diagnostics || "Wird gesammelt…"}
            </pre>
          </details>
        </div>

        <DialogFooter className="flex-wrap sm:justify-between">
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void copyReport()}
              disabled={diagnostics.length === 0}
            >
              <Copy className="size-3.5" />
              Kopieren
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void openMail()} disabled={!canSend}>
              <Mail className="size-3.5" />
              Per E-Mail
            </Button>
          </div>
          <Button onClick={() => void openGithub()} disabled={!canSend}>
            <ExternalLink className="size-3.5" />
            Auf GitHub melden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
