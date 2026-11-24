import { Slider } from "@/components/ui/slider";
import { ThemeColorField } from "@/features/settings/theme-color-field";
import { THEME_COLOR_TOKENS, type ThemeVariant } from "@/lib/app-themes";

type Props = {
  variant: ThemeVariant;
  onChange: (variant: ThemeVariant) => void;
};

const SLIDERS = [
  { key: "hue", label: "Farbton", min: 0, max: 360, step: 1 },
  { key: "chroma", label: "Sättigung", min: 0, max: 0.4, step: 0.005 },
  { key: "tint", label: "Tönung", min: 0, max: 5, step: 0.1 },
  { key: "surfaceHue", label: "Flächenton", min: 0, max: 360, step: 1 },
] as const;

const GROUPS = [
  {
    label: "Grundfarben",
    tokens: THEME_COLOR_TOKENS.filter((token) => !/^(sidebar|menu|chart)/.test(token)),
  },
  {
    label: "Seitenleiste & Menü",
    tokens: THEME_COLOR_TOKENS.filter((token) => /^(sidebar|menu)/.test(token)),
  },
  { label: "Diagramme", tokens: THEME_COLOR_TOKENS.filter((token) => token.startsWith("chart")) },
];

export function ThemeVariantFields({ variant, onChange }: Props) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {SLIDERS.map((slider) => {
          const value =
            slider.key === "surfaceHue" ? (variant.surfaceHue ?? variant.hue) : variant[slider.key];
          return (
            <div key={slider.key} className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{slider.label}</span>
                <span className="font-mono tabular-nums">{Number(value.toFixed(3))}</span>
              </div>
              <Slider
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={[value]}
                aria-label={slider.label}
                onValueChange={([next]) =>
                  next !== undefined && onChange({ ...variant, [slider.key]: next })
                }
              />
            </div>
          );
        })}
      </div>
      {GROUPS.map((group) => (
        <div key={group.label} className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">{group.label}</h4>
          <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2 lg:gap-x-6">
            {group.tokens.map((token) => (
              <ThemeColorField
                key={token}
                token={token}
                value={variant.colors?.[token]}
                onChange={(color) => {
                  const colors = { ...variant.colors, [token]: color };
                  if (!color) delete colors[token];
                  onChange({ ...variant, colors });
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
