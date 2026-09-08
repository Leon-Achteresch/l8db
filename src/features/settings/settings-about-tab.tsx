import { Bug, Check, Copy, ExternalLink, Terminal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BugReportDialog, collectDiagnosticText } from "@/features/settings/bug-report-dialog";
import { SettingsRow } from "@/features/settings/settings-row";
import { UpdateSection } from "@/features/settings/update-section";
import { copyText } from "@/lib/clipboard";

export function SettingsAboutTab() {
  const [copied, setCopied] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const copyDiagnosticInfo = async () => {
    const info = await collectDiagnosticText();

    try {
      await copyText(info);
      setCopied(true);
      toast.success("Diagnose-Informationen in die Zwischenablage kopiert");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Kopieren fehlgeschlagen");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Über & Updates</h2>
        <p className="text-xs text-muted-foreground">
          Versionsstatus, automatische Aktualisierungen und Systeminformationen.
        </p>
      </div>

      <UpdateSection />

      <div className="space-y-3 pt-2">
        <SettingsRow
          title="Systemdiagnose"
          description="Laufzeitumgebung und Debug-Informationen für Support oder Fehlerberichte."
        >
          <Button variant="outline" size="sm" onClick={() => void copyDiagnosticInfo()}>
            {copied ? (
              <Check className="size-3.5 text-emerald-500" />
            ) : (
              <Copy className="size-3.5" />
            )}
            <span>{copied ? "Kopiert" : "Infos kopieren"}</span>
          </Button>
        </SettingsRow>
        <SettingsRow
          title="Bug melden"
          description="Problem beschreiben und direkt auf GitHub melden, kopieren oder per E-Mail senden."
        >
          <Button variant="outline" size="sm" onClick={() => setReportOpen(true)}>
            <Bug className="size-3.5" />
            <span>Bug melden</span>
          </Button>
        </SettingsRow>
        <BugReportDialog open={reportOpen} onOpenChange={setReportOpen} />
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-2 text-xs text-muted-foreground">
        <a
          href="https://github.com/Leon-Achteresch/l8db"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <Terminal className="size-3.5" />
          <span>GitHub Repository</span>
          <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  );
}
