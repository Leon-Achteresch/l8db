import { Link } from "@tanstack/react-router";
import { Check, Copy } from "lucide";
import { BookOpen, Bug, ExternalLink, Info, Scale, Terminal } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { BugReportDialog, collectDiagnosticText } from "@/features/settings/bug-report-dialog";
import { OpenSourceLicensesDialog } from "@/features/settings/open-source-licenses-dialog";
import { SettingsRow } from "@/features/settings/settings-row";
import { UpdateSection } from "@/features/settings/update-section";
import { copyText } from "@/lib/clipboard";
import { useSettingsStore } from "@/lib/settings";

export function SettingsAboutTab() {
  const [copied, setCopied] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [licensesOpen, setLicensesOpen] = useState(false);
  const crashReports = useSettingsStore((s) => s.crashReports);
  const setCrashReports = useSettingsStore((s) => s.setCrashReports);
  const usageMetrics = useSettingsStore((s) => s.usageMetrics);
  const setUsageMetrics = useSettingsStore((s) => s.setUsageMetrics);

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

      <SettingsRow settingId="about">
        <Button variant="outline" size="sm" asChild>
          <Link to="/about">
            <Info className="size-3.5" />
            <span>Über anzeigen</span>
          </Link>
        </Button>
      </SettingsRow>

      <SettingsRow settingId="documentation">
        <Button variant="outline" size="sm" asChild>
          <Link to="/docs">
            <BookOpen className="size-3.5" />
            <span>Docs öffnen</span>
          </Link>
        </Button>
      </SettingsRow>

      <SettingsRow settingId="open-source-licenses" featureId="settings.about.open-source-licenses">
        <Button variant="outline" size="sm" onClick={() => setLicensesOpen(true)}>
          <Scale className="size-3.5" />
          <span>Lizenzen anzeigen</span>
        </Button>
      </SettingsRow>
      <OpenSourceLicensesDialog open={licensesOpen} onOpenChange={setLicensesOpen} />

      <UpdateSection />

      <div className="space-y-3 pt-2">
        <SettingsRow settingId="diagnostics">
          <Button variant="outline" size="sm" onClick={() => void copyDiagnosticInfo()}>
            <MorphIcon
              icon={copied ? Check : Copy}
              className={copied ? "size-3.5 text-emerald-500" : "size-3.5"}
            />
            <span>{copied ? "Kopiert" : "Infos kopieren"}</span>
          </Button>
        </SettingsRow>
        <SettingsRow settingId="crash-reports" featureId="settings.about.crash-reports">
          <Switch
            checked={crashReports}
            onCheckedChange={setCrashReports}
            aria-label="Absturzberichte senden"
          />
        </SettingsRow>
        <SettingsRow settingId="usage-metrics" featureId="settings.about.usage-metrics">
          <Switch
            checked={usageMetrics}
            onCheckedChange={setUsageMetrics}
            aria-label="Nutzungs- und Leistungsdaten senden"
          />
        </SettingsRow>
        <SettingsRow settingId="bug-report">
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
