import { ImageUpIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  CARD_LABEL,
  type DashboardTheme,
  DENSITY_LABEL,
  FONT_LABEL,
  MAX_IMAGE_BYTES,
  MAX_PALETTE,
  readImageFile,
  THEME_PRESETS,
  type ThemeCard,
  type ThemeDensity,
  type ThemeFont,
  themeShowsHeader,
} from "@/lib/dashboards";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { ThemeColorField } from "./theme-color-field";

const COLORS: [keyof DashboardTheme, string][] = [
  ["primary", "Akzent"],
  ["background", "Hintergrund"],
  ["surface", "Karten"],
  ["text", "Text"],
  ["muted", "Nebentext"],
  ["border", "Rahmen"],
];

const SECTION = "space-y-2.5 border-t pt-3";
const HEADING = "text-xs font-semibold";

export function DashboardThemeEditor({
  theme,
  onChange,
}: {
  theme: DashboardTheme;
  onChange: (theme: DashboardTheme) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { ref } = useNewFeatureVisibility<HTMLDivElement>("dashboard.design.theme");
  const patch = (next: Partial<DashboardTheme>) => {
    const merged: DashboardTheme = { ...theme, ...next };
    for (const key of Object.keys(merged) as (keyof DashboardTheme)[])
      if (merged[key] === undefined || merged[key] === "") delete merged[key];
    onChange(merged);
  };
  const palette = theme.palette ?? [];
  return (
    <div ref={ref} className="space-y-3">
      <div className="space-y-2">
        <h3 className={HEADING}>Vorlagen</h3>
        <div className="flex flex-wrap gap-1.5">
          {THEME_PRESETS.map((preset) => (
            <Button
              key={preset.name}
              variant="outline"
              size="sm"
              onClick={() =>
                onChange({
                  ...preset.theme,
                  brand: theme.brand,
                  tagline: theme.tagline,
                  logo: theme.logo,
                  header: theme.header,
                  nav: theme.nav,
                })
              }
            >
              <span
                aria-hidden="true"
                className="size-3 rounded-full border"
                style={{ background: preset.theme.primary }}
              />
              {preset.name}
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => onChange({})}>
            <RotateCcwIcon /> Standard
          </Button>
        </div>
      </div>
      <div className={SECTION}>
        <h3 className={HEADING}>Marke</h3>
        <Input
          aria-label="Markenname"
          value={theme.brand ?? ""}
          maxLength={80}
          placeholder="Firmen- oder Seitenname"
          onChange={(e) => patch({ brand: e.target.value })}
          className="h-8 text-xs"
        />
        <Input
          aria-label="Untertitel"
          value={theme.tagline ?? ""}
          maxLength={160}
          placeholder="Untertitel, z. B. Vertriebsreporting Q3"
          onChange={(e) => patch({ tagline: e.target.value })}
          className="h-8 text-xs"
        />
        <div className="flex items-center gap-2">
          {theme.logo ? (
            <img
              src={theme.logo}
              alt="Logo"
              className="h-9 max-w-32 rounded border object-contain"
            />
          ) : null}
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <ImageUpIcon /> {theme.logo ? "Logo ersetzen" : "Logo hochladen"}
          </Button>
          {theme.logo && (
            <Button variant="ghost" size="sm" onClick={() => patch({ logo: undefined })}>
              <Trash2Icon /> Entfernen
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            className="hidden"
            aria-label="Logo-Datei auswählen"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                patch({ logo: await readImageFile(file, MAX_IMAGE_BYTES) });
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Logo ungültig");
              }
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span>Kopfzeile mit Logo und Name zeigen</span>
          <Switch
            aria-label="Kopfzeile zeigen"
            checked={themeShowsHeader(theme)}
            onCheckedChange={(header) => patch({ header })}
          />
        </div>
      </div>
      <div className={SECTION}>
        <h3 className={HEADING}>Farben</h3>
        {COLORS.map(([key, label]) => (
          <ThemeColorField
            key={key}
            label={label}
            value={theme[key] as string | undefined}
            onChange={(value) => patch({ [key]: value })}
          />
        ))}
      </div>
      <div className={SECTION}>
        <h3 className={HEADING}>Diagrammfarben</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {Array.from({ length: MAX_PALETTE }, (_, index) => (
            <input
              key={String(index)}
              type="color"
              aria-label={`Diagrammfarbe ${index + 1}`}
              value={/^#[0-9a-f]{6}$/i.test(palette[index] ?? "") ? palette[index] : "#888888"}
              disabled={index > palette.length}
              onChange={(e) => {
                const next = [...palette];
                next[index] = e.target.value;
                patch({ palette: next });
              }}
              className="size-7 cursor-pointer rounded-md border bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-30"
            />
          ))}
          {palette.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => patch({ palette: undefined })}>
              Zurücksetzen
            </Button>
          )}
        </div>
      </div>
      <div className={SECTION}>
        <h3 className={HEADING}>Schrift und Form</h3>
        <div className="grid grid-cols-2 gap-2">
          <Select
            value={theme.font ?? "default"}
            onValueChange={(font) =>
              patch({ font: font === "default" ? undefined : (font as ThemeFont) })
            }
          >
            <SelectTrigger aria-label="Schrift" size="sm" className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Schrift: App-Standard</SelectItem>
              {(Object.keys(FONT_LABEL) as ThemeFont[]).map((font) => (
                <SelectItem key={font} value={font}>
                  Schrift: {FONT_LABEL[font]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={theme.card ?? "outlined"}
            onValueChange={(card) => patch({ card: card as ThemeCard })}
          >
            <SelectTrigger aria-label="Kartenstil" size="sm" className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(CARD_LABEL) as ThemeCard[]).map((card) => (
                <SelectItem key={card} value={card}>
                  Karten: {CARD_LABEL[card]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={theme.density ?? "normal"}
            onValueChange={(density) => patch({ density: density as ThemeDensity })}
          >
            <SelectTrigger aria-label="Abstände" size="sm" className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(DENSITY_LABEL) as ThemeDensity[]).map((density) => (
                <SelectItem key={density} value={density}>
                  Abstände: {DENSITY_LABEL[density]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={theme.nav ?? "tabs"}
            onValueChange={(nav) => patch({ nav: nav as "tabs" | "sidebar" })}
          >
            <SelectTrigger aria-label="Seitennavigation" size="sm" className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tabs">Seiten: Reiter oben</SelectItem>
              <SelectItem value="sidebar">Seiten: Seitenleiste</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="w-24 shrink-0">Ecken {theme.radius ?? 8} px</span>
          <Slider
            aria-label="Eckenradius"
            min={0}
            max={32}
            step={1}
            value={[theme.radius ?? 8]}
            onValueChange={([radius]) => patch({ radius })}
          />
        </div>
      </div>
    </div>
  );
}
