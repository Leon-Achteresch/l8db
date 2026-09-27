import "@fontsource-variable/geist";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/plus-jakarta-sans";
import type { CSSProperties } from "react";
import { TabPreview } from "./tab-preview";

const fonts = [
  {
    family: "Geist Variable",
    title: "Geist (bisher)",
    description: "Referenz: die bisherige App-Schrift.",
  },
  {
    family: "IBM Plex Sans Variable",
    title: "IBM Plex Sans (aktuell)",
    description:
      "Technisch, klar unterscheidbare Glyphen (l/1/I), für datenlastige Oberflächen gebaut.",
  },
  {
    family: "Instrument Sans Variable",
    title: "Instrument Sans",
    description: "Leicht schmal und präzise, passt viel Text in dichte Tabellen.",
  },
  {
    family: "DM Sans Variable",
    title: "DM Sans",
    description: "Geometrisch und freundlich, niedriger Kontrast, gut bei kleinen Größen.",
  },
  {
    family: "Plus Jakarta Sans Variable",
    title: "Plus Jakarta Sans",
    description: "Modern mit etwas Charakter, hohe x-Höhe.",
  },
];

export function FontLab() {
  return (
    <div className="space-y-10">
      {fonts.map(({ family, title, description }) => (
        <section
          key={family}
          aria-label={title}
          className="space-y-3"
          style={
            {
              "--font-sans": `'${family}', sans-serif`,
              fontFamily: `'${family}', sans-serif`,
            } as CSSProperties
          }
        >
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
            <p className="text-sm tabular-nums">
              0123456789 · Il1 O0 · SELECT * FROM kunden WHERE umsatz &gt; 1.234,56
            </p>
          </div>
          <TabPreview variant="flat" many />
        </section>
      ))}
    </div>
  );
}
