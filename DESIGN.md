---
name: l8db
description: A fast native desktop database client whose quiet, hue-tinted workbench lets the data and the AI's figures carry the colour.
colors:
  primary: "oklch(0.4 0.12 248)"
  primary-foreground: "oklch(0.99 0.005 248)"
  ring: "oklch(0.5 0.06 248)"
  background: "oklch(0.975 0.004 248)"
  foreground: "oklch(0.22 0.012 248)"
  card: "oklch(0.995 0.002 248)"
  card-foreground: "oklch(0.2 0.01 248)"
  popover: "oklch(0.995 0.003 248)"
  secondary: "oklch(0.95 0.008 248)"
  muted: "oklch(0.955 0.006 248)"
  muted-foreground: "oklch(0.46 0.012 248)"
  accent: "oklch(0.945 0.01 248)"
  border: "oklch(0.89 0.008 248)"
  input: "oklch(0.91 0.008 248)"
  sidebar: "oklch(0.965 0.004 248)"
  sidebar-accent: "oklch(0.925 0.008 248)"
  destructive: "oklch(0.56 0.2 28)"
  dark-background: "oklch(0.175 0.02 248)"
  dark-card: "oklch(0.21 0.022 248)"
  dark-foreground: "oklch(0.97 0.01 248)"
  dark-primary: "oklch(0.78 0.14 248)"
  dark-muted-foreground: "oklch(0.74 0.03 248)"
  access-read: "oklch(0.696 0.17 162.48)"
  access-write: "oklch(0.769 0.188 70.08)"
  access-schema: "oklch(0.637 0.237 25.331)"
  figure-lime: "#a3e635"
  figure-blue: "#3b82f6"
  figure-violet: "#c084fc"
  figure-pink: "#f472b6"
  figure-yellow: "#facc15"
  figure-teal: "#2dd4bf"
  figure-orange: "#fb923c"
  figure-slate: "#94a3b8"
typography:
  display:
    fontFamily: "IBM Plex Sans Variable, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "IBM Plex Sans Variable, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.375
    letterSpacing: "-0.005em"
  title:
    fontFamily: "IBM Plex Sans Variable, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.005em"
  body:
    fontFamily: "IBM Plex Sans Variable, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
    fontFeature: "\"tnum\" 1"
  body-ui:
    fontFamily: "IBM Plex Sans Variable, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "IBM Plex Sans Variable, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
  micro:
    fontFamily: "IBM Plex Sans Variable, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.4
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.625
rounded:
  sm: "6px"
  md: "9px"
  lg: "12px"
  xl: "15px"
  2xl: "18px"
  4xl: "24px"
  full: "9999px"
spacing:
  "1": "4px"
  "1.5": "6px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  app-header: "46px"
  panel-header: "48px"
  access-strip: "36px"
  history-rail: "240px"
  results-shelf: "400px"
  reading-measure: "704px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "36px"
    typography: "{typography.body-ui}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    size: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.muted}"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "36px"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "4px 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
    padding: "24px"
  figure-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
  figure-label:
    backgroundColor: "color-mix(in oklab, oklch(0.4 0.12 248) 10%, transparent)"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "2px 6px"
    typography: "{typography.label}"
  figure-reference:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "10px 12px"
  composer:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.2xl}"
  access-strip-read:
    backgroundColor: "color-mix(in oklab, oklch(0.696 0.17 162.48) 6%, transparent)"
    height: "36px"
  access-strip-write:
    backgroundColor: "color-mix(in oklab, oklch(0.769 0.188 70.08) 10%, transparent)"
    height: "36px"
  access-strip-schema:
    backgroundColor: "color-mix(in oklab, oklch(0.637 0.237 25.331) 8%, transparent)"
    height: "36px"
  work-station:
    backgroundColor: "{colors.muted-foreground}"
    rounded: "{rounded.full}"
    size: "9px"
  work-station-active:
    backgroundColor: "{colors.primary}"
  panel-tab-active:
    textColor: "{colors.foreground}"
    height: "36px"
    typography: "{typography.body-ui}"
  segmented-thumb:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "24px"
  followup-list:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.xl}"
    padding: "8px 12px"
---

# Design System: l8db

## Overview

**Creative North Star: "The Instrument Bench"**

l8db is a workbench for long sessions next to editors and terminals. The chrome is a family of near-white (or near-black) neutrals that all carry one hue, `--db-hue` (248 by default), so the whole app shifts tone with the active database without ever becoming colourful. Colour is spent where it carries meaning: the navy primary for focus, selection and the primary action; destructive red; the AI's three access colours; and the chart palette that makes data legible. Everything else is quiet, dense and tabular.

The surface is built from shadcn primitives restyled onto that tinted ground: generously rounded corners rooted in one radius token (12px), hairline borders, whisper-light shadows, IBM Plex Sans at small desktop sizes with tabular figures everywhere. A user-selectable density setting moves control heights in quarter-rem steps without changing the language.

The AI assistant extends the bench with its own surface language. It answers in short prose and hands over numbered figures ("Abb. 1", "Abb. 2") that collect in a results shelf; a thin work line with station dots runs beside every answer and records each step, including approvals; and the composer wears an access strip as its top edge whose tint says what the AI may do to the database right now.

**Key Characteristics:**
- Neutrals tinted by a single database hue, light and dark.
- Navy primary used sparingly for focus, selection, figure labels and the main action.
- IBM Plex Sans throughout, 10 to 15px for UI, tabular numerals by default; monospace only for machine text.
- One radius root (12px) scaled into a family of soft corners.
- Flat surfaces with hairline borders; shadows are barely there.
- AI answers as prose plus numbered figures, a station-dot work line and a colour-coded access strip.

## Colors

A cool, hue-tinted neutral system with one navy voice and a small set of semantic signals.

### Primary
- **Bench Navy** (primary): the primary action button, focus and selection, active tab underline, the "Abb." figure label tint, the active work-line station and the unread dot. In dark mode it lifts to **Night Navy** (dark-primary) so it reads on the deep ground.
- **Focus Ring** (ring): a desaturated navy used for focus outlines (2px, offset 3px on buttons and links) and the 3px soft ring on inputs.

### Secondary
- **Access Emerald** (access-read): AI may only read. Tints the access strip at 6% and fills the level dot.
- **Access Amber** (access-write): AI may change data after approval. Tints the strip at 10%; also marks an approved ("Erlaubt") station on the work line.
- **Access Red** (access-schema): AI may change schema, or any write on a connection marked as production. Tints the strip at 8% and carries the "Produktion" chip.

### Tertiary
- **Figure palette** (figure-lime through figure-slate): the eight-colour series palette shared by dashboard charts and AI figures, in this order. A figure pinned from the AI to a dashboard keeps its colours.

### Neutral
- **Tinted Paper** (background): the app ground and the workspace canvas.
- **Card White** (card) and **Popover White** (popover): raised content surfaces, a hair brighter than the ground.
- **Ink** (foreground, card-foreground): primary text; never pure black.
- **Quiet Ink** (muted-foreground): secondary text, icons, captions, idle work-line stations.
- **Mist** (muted, secondary, accent): hover fills, segmented-control tracks, code and detail wells, table footers.
- **Hairline** (border, input): every divider and outline.
- **Rail** (sidebar, sidebar-accent): navigation rails and the AI history rail.
- **Night ground** (dark-background, dark-card, dark-foreground, dark-muted-foreground): the dark theme; borders there are translucent white (12%, inputs 16%).
- **Signal Red** (destructive): errors, failed and denied stations, destructive buttons drawn as a 10% red wash with red text.

### Named Rules
**The Tinted Neutral Rule.** Every solid neutral is an OKLCH value at `--db-hue` with chroma at or below 0.03. Translucent white or black borders and shadows are the only untinted values.

**The Access Is Colour Rule.** Emerald, amber and red mean read, write and schema/production access in the AI. They are never used decoratively elsewhere on an AI surface.

**The Shared Figure Palette Rule.** Charts draw series colours from the shared figure palette, in order, so the same result looks the same in a figure, the shelf and a dashboard.

## Typography

**Body Font:** IBM Plex Sans Variable (with sans-serif)
**Label/Mono Font:** the system monospace stack (ui-monospace, SF Mono, Menlo, Consolas)

**Character:** Plex Sans is technical but warm, set small and slightly tightened on titles; monospace appears only where the text is something a machine would read.

### Hierarchy
- **Display** (600, 22px, 1.25, -0.02em): the empty-state heading of the AI and comparable single-purpose screens.
- **Headline** (500, 15px, 1.375, -0.005em): the user's question in the AI transcript, so each turn is anchored by what was asked.
- **Title** (600, 13px, -0.005em): panel and rail headers ("Gespräche", "Ergebnisse"), conversation titles, figure captions (at 500).
- **Body** (400, 14px, 1.65): AI answer prose, at 90% foreground with bold in full foreground; held to the reading measure.
- **Body UI** (400, 13px): work-line rows, follow-up questions, tabs, markdown tables.
- **Label** (500, 11px): figure labels, row counts, captions, menu hints, the "Ergebnisse" count.
- **Micro** (600, 10px): chips such as "Produktion", footnotes in menus.
- **Mono** (400, 11px, 1.625): SQL, tool output, identifiers, and the number inside "Abb. n".

### Named Rules
**The Mono For Machines Rule.** Monospace is for SQL, identifiers, raw output and figure numbers. Prose, labels and buttons stay in Plex Sans.

**The Tabular Ground Rule.** The body sets `font-variant-numeric: tabular-nums`; numbers in tables, counts and timers align without per-element opt-in.

## Layout

The app is a framed workbench: a 46px app header, an icon rail and a connection sidebar on the left, a bezel-framed workspace in the middle, and an optional AI panel on the right. Density is a global setting that shifts control heights by a step (compact -4px, spacious +6px) and table cell padding (2px, 6px or 10px).

Spacing follows the 4px Tailwind grid; 6, 8 and 12px do most of the work inside controls, 16 and 24px between groups.

AI panel: a 48px header (title, new, history, one overflow menu, close), an underline tab row "Gespräch | Ergebnisse n" that appears once figures exist, the transcript, and the composer pinned at the bottom with the 36px access strip as its top edge. Full page: a 240px history rail on the left, the dialog centred at the reading measure, and a 400px results shelf on the right on a muted ground.

**The Reading Measure Rule.** Transcript content is capped at 704px (44rem; 46rem for the full-page empty state) and centred; answers never stretch to the window.

## Elevation & Depth

Depth is mostly tonal: card and popover sit a few lightness points above the ground, and hairline borders do the separating. Shadows exist but stay faint and wide, with a 1px inner highlight on cards and inputs in light mode. Dark mode replaces shadow cues with a faint top-down gradient on the shell bezel.

### Shadow Vocabulary
- **Hairline lift** (`box-shadow: 0 1px 2px oklch(0 0 0 / 4%)`): figure cards at rest.
- **Card ambient** (`box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.28), 0 10px 28px -22px oklch(0 0 0 / 0.35)`): shadcn cards.
- **Composer float** (`box-shadow: 0 1px 2px oklch(0 0 0 / 4%), 0 10px 28px -16px oklch(0 0 0 / 18%)`): the AI composer.
- **Active tab** (`box-shadow: 0 1px 3px oklch(0 0 0 / 8%)`): the selected pill in segmented tabs.
- **Menu drop** (`filter: drop-shadow(0 8px 16px rgb(0 0 0 / 0.14)) drop-shadow(0 1px 2px rgb(0 0 0 / 0.08))`): icon menus.
- **Toast** (`box-shadow: 0 14px 36px -10px oklch(0 0 0 / 24%), 0 4px 10px -4px oklch(0 0 0 / 12%)`): the only strong shadow, for transient notices.
- **Figure focus** (`box-shadow: 0 0 0 3px color-mix(in oklab, var(--primary) 14%, transparent)`): a focused figure in the shelf, with a 50% primary border.

### Named Rules
**The Whisper Shadow Rule.** Resting surfaces use a shadow no darker than 4% at small offsets; anything heavier is reserved for floating, transient layers.

## Shapes

All corners derive from one root, `--radius` (12px), multiplied into a soft family: 6px for small icon wells and close buttons, 9px for chips, figure labels and segmented thumbs, 12px for buttons, inputs and menu items, 15px for cards, figures, follow-up lists and the user's edit box, 18px for the composer, popovers and toasts, and about 17px for the shell bezel. Status dots and work-line stations are full circles. Borders are 1px hairlines; the AI work line is a 1px vertical rule that fades out at its bottom.

**The One Radius Root Rule.** New radii are expressed as a multiple of `--radius`, never as a free pixel value, so the whole app stays concentric when the root changes.

## Components

### Buttons
- **Shape:** gently rounded (12px), 36px tall by default, density-adjusted; icon buttons are 36px squares.
- **Primary:** Bench Navy fill with near-white text, 13 to 14px medium; hover drops to 80% opacity.
- **Ghost:** transparent, Mist fill on hover and while its menu is open; the default for toolbar and header icons.
- **Outline:** ground-coloured with a hairline border and a faint shadow.
- **Destructive:** a 10% red wash with red text, not a solid red block.
- **States:** 160 to 200ms colour transitions on the smooth-out curve; pressing scales to 0.98 or nudges down 1px; focus shows a 3px soft ring in the focus colour.

### Chips
- **Style:** small rounded rectangles (9px), 20px tall, 12px medium; the count chip and figure label use a 10% navy wash with navy text.
- **Production chip:** 10px semibold on a 15% red wash, inline in the access strip.

### Cards / Containers
- **Corner Style:** 15px.
- **Background:** Card White on the tinted ground.
- **Shadow Strategy:** Card ambient or Hairline lift (see Elevation & Depth).
- **Border:** hairline border or a 1px ring at 8% foreground.
- **Internal Padding:** 24px for shadcn cards, 12px for AI figures and lists.

### Inputs / Fields
- **Style:** 36px tall, 12px radius, hairline input border, ground at 80% with an inner top highlight.
- **Focus:** border turns Bench Navy plus a 3px soft focus ring.
- **Error / Disabled:** red border with a 20% red ring; disabled at 50% opacity.

### Navigation
- **App header:** 46px, a centred greeting island, ghost icon buttons on the right.
- **Rails:** Rail-coloured sidebars with icon rows; active rows use the sidebar accent fill.
- **Tabs:** two forms. Segmented tabs sit in a Mist track with a ground or card thumb and a faint shadow. AI panel tabs are underline tabs, 36px tall, 13px, with a 2px Bench Navy underline on the active tab.

### AI Figure ("Abb. n")
A numbered result card for every chart or table the AI produces. Caption row: the "Abb." label (sans, with the number in monospace) in a navy-washed chip, the title at 13px medium, a "Diagramm | Tabelle" segmented switch and export actions. Body: the chart (192px in the transcript, 256px in the shelf, bars sized by row count) or the table. Footer: an 11px row count on a muted wash with a "SQL" disclosure that opens the statement in monospace. When the shelf is visible, the transcript shows a compact **figure reference** row instead (label, title, kind and row count, an up-right arrow) that focuses the figure in the shelf.

### AI Results Shelf
A scrolling column of full figures, 16px apart, on a muted ground. The empty state is a small bordered icon well with one 12px sentence explaining that figures collect here.

### AI Access Strip
The 36px top edge of the composer, tinted by access level: the connection selector (with the production chip), a hairline divider, the access-level menu with its coloured dot ("Nur lesen", "Daten ändern", "Schema ändern", or a locked "Schreibgeschützt"), the approval-mode control, and usage on the right. Its tint changes with a 300ms colour transition. Any write level on a production connection takes the red tint.

### AI Work Line
A 1px vertical rule 7px from the answer's left edge with 9px station dots, each cut out of the rule by a 3px ground-coloured halo. Stations are idle (Quiet Ink at 45%), active (Bench Navy with a ping pulse, disabled under reduced motion), failed or denied (Signal Red), allowed (Access Amber), or the hollow lead station of the turn header ("3 Schritte · unter 1 s"). Each row is 13px Quiet Ink with a leading icon and expands to a monospace detail well.

### Follow-up List
A bordered 15px card with hairline-divided rows, each a 13px question behind a corner-down-right arrow; a right arrow slides in on hover or focus.

## Do's and Don'ts

### Do:
- **Do** derive every new neutral from `--db-hue` in OKLCH so the surface follows the active database.
- **Do** reserve Bench Navy for focus, selection, the primary action and figure labels.
- **Do** number every AI chart or table as "Abb. n" and send it to the results shelf.
- **Do** show the AI's access level as the composer's tinted top edge, with production writes always red.
- **Do** record every agent step, including approvals as "Erlaubt"/"Abgelehnt", as a station on the work line.
- **Do** draw chart series from the shared figure palette in order.
- **Do** honour reduced motion: pulses, morphs and pings collapse to fades or stop.

### Don't:
- **Don't** use emerald, amber or red for decoration on AI surfaces; they mean access.
- **Don't** put more than new, history, one overflow menu and close in the AI panel header.
- **Don't** set prose, labels or buttons in monospace.
- **Don't** let AI answer text run wider than the 704px reading measure.
- **Don't** introduce radii that are not multiples of `--radius`.
- **Don't** put heavy shadows on resting surfaces; strong shadows belong to toasts and floating menus.
