import type { ThemeMode, ThemeVariant } from "@/lib/app-themes";

type Props = {
  mode: ThemeMode;
  variant: ThemeVariant;
  className?: string;
  style?: React.CSSProperties;
};

export function ColorSchemePreview({ mode, variant, className, style }: Props) {
  const { hue, chroma, tint } = variant;
  const dark = mode === "dark";
  const surface = (light: number, base: number) =>
    `oklch(${light} ${(base * tint).toFixed(4)} ${hue})`;
  const bg = dark ? surface(0.17, 0.008) : surface(0.975, 0.004);
  const sidebar = dark ? surface(0.19, 0.008) : surface(0.965, 0.004);
  const line = dark ? "oklch(1 0 0 / 12%)" : surface(0.89, 0.008);
  const bar = dark ? surface(0.3, 0.01) : surface(0.9, 0.008);
  const card = dark ? surface(0.21, 0.009) : surface(0.995, 0.002);
  const accent = `oklch(${dark ? 0.72 : 0.55} ${Math.max(chroma * 2, 0.02)} ${hue})`;
  return (
    <div aria-hidden className={className} style={{ ...style, background: bg }}>
      <div className="flex h-full">
        <div
          className="flex w-1/4 flex-col gap-1.5 border-r p-2"
          style={{ background: sidebar, borderColor: line }}
        >
          <div
            className="h-2.5 rounded-full border"
            style={{ borderColor: line, background: card }}
          />
          <div className="h-2 rounded-full" style={{ background: bar }} />
          <div className="h-2 rounded-full" style={{ background: bar }} />
          <div className="h-2 rounded-full" style={{ background: bar }} />
        </div>
        <div className="relative flex flex-1 flex-col gap-1.5 p-2">
          <div className="ml-auto h-2.5 w-1/4 rounded-full" style={{ background: bar }} />
          <div className="mt-2 h-1.5 w-1/2 rounded-full" style={{ background: bar }} />
          <div className="h-1.5 w-1/3 rounded-full" style={{ background: bar }} />
          <div
            className="absolute top-3 right-2 flex w-1/4 flex-col gap-1.5 rounded-md border p-1.5"
            style={{ background: card, borderColor: line }}
          >
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-1">
                <span className="size-1 rounded-full" style={{ background: accent }} />
                <span className="h-1 flex-1 rounded-full" style={{ background: bar }} />
              </div>
            ))}
          </div>
          <div
            className="mt-auto flex items-center gap-1 rounded-md border p-1"
            style={{ background: card, borderColor: line }}
          >
            <span className="h-1.5 flex-1 rounded-full" style={{ background: bar }} />
            <span className="size-2.5 rounded-full" style={{ background: accent }} />
          </div>
        </div>
      </div>
    </div>
  );
}
