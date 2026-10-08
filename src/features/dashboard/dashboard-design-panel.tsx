import { DownloadIcon, RotateCcwIcon, SparklesIcon, UploadIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAiStore } from "@/lib/ai/store";
import {
  compileDashboardCss,
  DASHBOARD_DESIGN_PRESETS,
  DASHBOARD_DESIGN_SELECTORS,
  type DashboardDesign,
  dashboardDesignPrompt,
  MAX_DASHBOARD_CSS_BYTES,
  validateDashboardDesign,
} from "@/lib/dashboard-design";
import { useDashboardsStore } from "@/lib/dashboards";
import { saveDashboardForDesignAi } from "@/lib/db/dashboard-design";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function DashboardDesignPanel({
  dashboardId,
  design,
  error,
  onChange,
  onClose,
  onSave,
}: {
  dashboardId: string;
  design: DashboardDesign;
  error: string;
  onChange: (design: DashboardDesign) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const operationRef = useRef(0);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const { ref } = useNewFeatureVisibility<HTMLElement>("dashboard.design.css");
  useEffect(
    () => () => {
      operationRef.current++;
    },
    [],
  );

  const changeCss = (css: string) => {
    operationRef.current++;
    try {
      validateDashboardDesign({ ...design, css });
      onChange({ ...design, css });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "CSS konnte nicht geladen werden.");
    }
  };

  const checkCss = () => {
    try {
      compileDashboardCss(design.css, '[data-dashboard-design="validation"]');
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "CSS konnte nicht geladen werden.");
      return false;
    }
  };

  const askAi = async () => {
    if (!checkCss()) return;
    const current = useDashboardsStore.getState().dashboards.find((d) => d.id === dashboardId);
    if (!current) return;
    setBusy(true);
    try {
      const next = { ...current, design };
      const stamp = await saveDashboardForDesignAi(next);
      useDashboardsStore.getState().update(current.id, {
        design,
        mcpId: current.mcpId ?? current.id,
        mcpStamp: stamp,
      });
      useAiStore.getState().ask(dashboardDesignPrompt(next, request.trim()));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "KI konnte nicht geöffnet werden.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      ref={ref}
      aria-label="Dashboard-Design"
      className="flex min-h-0 w-[440px] max-w-[55vw] shrink-0 flex-col border-l bg-background text-foreground"
    >
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Dashboard gestalten</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Freies CSS · Live-Vorschau</p>
        </div>
        <IconButton
          variant="ghost"
          size="icon-sm"
          aria-label="Design-Editor schließen"
          disabled={busy}
          onClick={onClose}
        >
          <XIcon />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="dashboard-css-enabled" className="text-xs font-medium">
            Eigenes CSS aktivieren
          </label>
          <Switch
            id="dashboard-css-enabled"
            checked={design.enabled}
            disabled={busy}
            onCheckedChange={(enabled) => onChange({ ...design, enabled })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Farben, Schriften, Abstände, Rahmen, Hintergründe, Layouts, SVG, Animationen und alle
          weiteren CSS-Eigenschaften. Die Vorschau gilt nur für dieses Dashboard. Änderungen werden
          mit „Übernehmen“ gespeichert.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {DASHBOARD_DESIGN_PRESETS.map((preset) => (
            <Button
              key={preset.name}
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onChange({ enabled: true, css: preset.css })}
            >
              {preset.name}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <UploadIcon /> CSS importieren
          </Button>
          <input
            ref={fileRef}
            className="hidden"
            type="file"
            accept=".css,text/css"
            aria-label="CSS-Datei auswählen"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              const operation = ++operationRef.current;
              if (!file) return;
              if (file.size > MAX_DASHBOARD_CSS_BYTES) {
                toast.error("Die CSS-Datei darf höchstens 256 KiB groß sein.");
                return;
              }
              try {
                const css = await file.text();
                if (operation !== operationRef.current) return;
                validateDashboardDesign({ css, enabled: true });
                onChange({ css, enabled: true });
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Datei konnte nicht gelesen werden.",
                );
              }
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              const url = URL.createObjectURL(new Blob([design.css], { type: "text/css" }));
              const link = document.createElement("a");
              link.href = url;
              link.download = "dashboard.css";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            <DownloadIcon /> Exportieren
          </Button>
          <IconButton
            variant="ghost"
            size="icon-sm"
            aria-label="Design zurücksetzen"
            disabled={busy}
            onClick={() => onChange({ css: "", enabled: true })}
          >
            <RotateCcwIcon />
          </IconButton>
        </div>
        <label htmlFor="dashboard-css" className="text-xs font-medium">
          Eigenes CSS
        </label>
        <textarea
          id="dashboard-css"
          aria-label="Dashboard-CSS"
          className="min-h-64 w-full flex-1 resize-y rounded-md border bg-muted/20 p-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
          spellCheck={false}
          disabled={busy}
          value={design.css}
          placeholder={
            ".dashboard-widget {\n  border-radius: 24px;\n  box-shadow: 0 8px 30px #0002;\n}\n\n:root {\n  --dash-color-1: #8b5cf6;\n}"
          }
          onChange={(event) => changeCss(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              if (checkCss()) onSave();
            }
          }}
        />
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">Selektoren und CSS-Variablen</summary>
          <div className="mt-2 space-y-1 text-muted-foreground">
            {DASHBOARD_DESIGN_SELECTORS.map(([selector, description]) => (
              <p key={selector}>
                <code className="text-foreground">{selector}</code> · {description}
              </p>
            ))}
            <p className="pt-2">
              :root / :scope = Dashboard. --dash-color-1 bis --dash-color-8, --dash-accent,
              --dash-compare, --background, --foreground, --card, --border.
            </p>
            <p>
              Externe Ressourcen und @import unterliegen der App-CSP. Für eine Datei „CSS
              importieren“ nutzen; @import wird vom CSS-Parser nicht eingebunden.
            </p>
          </div>
        </details>
        <div className="space-y-2 border-t pt-3">
          <label htmlFor="dashboard-design-request" className="text-xs font-medium">
            Mit KI gestalten
          </label>
          <Input
            id="dashboard-design-request"
            value={request}
            disabled={busy}
            onChange={(event) => setRequest(event.target.value)}
            placeholder="Dunkel, violette Akzente, große Kennzahlen…"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !request.trim()}
            onClick={() => void askAi()}
          >
            <SparklesIcon /> {busy ? "KI wird geöffnet…" : "Design mit KI ändern"}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Strg/⌘ + Umschalt + D öffnet den Editor und schaltet eigenes CSS vorübergehend aus. So
          bleibt das Dashboard auch nach ungünstigen CSS-Regeln erreichbar.
        </p>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t p-3">
        <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
          Verwerfen
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            if (checkCss()) onSave();
          }}
        >
          Übernehmen
        </Button>
      </div>
    </section>
  );
}
