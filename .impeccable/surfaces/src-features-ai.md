---
version: 1
slug: "src-features-ai"
primary_target: "src/features/ai"
related_targets: ["src/routes/_app.ai.tsx"]
---

# KI-Bereich (Panel, Vollseite, minimiert)

Scope: the whole AI feature in src/features/ai: side panel, full page /ai, minimized island, onboarding, settings, history, knowledge dialog.
Mode: Operate. Audience: developers/DBAs and business users equally, panel and full page weighted equally.
Constraint: every existing function stays; German UI; too many equal buttons is the named failure.

## Direction contract

THESIS: The assistant answers in short prose and hands over numbered figures (Abb. 1, 2, 3) that collect in a results shelf; it refuses the chat transcript where heavy chart cards interrupt the text and six equal icons rule the header.

OWN-WORLD: l8db neutrals tinted by --db-hue, IBM Plex Sans for prose and Plex Mono only for SQL and figures' numbers, primary navy as the figure and focus colour. Access is colour: read emerald, data writes amber, schema changes and production red. Charts keep the shared dashboard palette so a figure looks the same once pinned to a dashboard. A thin work line with station dots runs beside every answer.

STORY: The user asks in plain language, sees at once which connection and which access the AI has, reads a two-sentence answer, scans its figures, and finds every result again in the shelf to export or open as SQL.

FIRST VIEWPORT: Panel: 48px header with conversation title, new, history, one overflow menu, close; segmented Gespräch | Ergebnisse n; transcript with question lines, answers, work line and inline figures; composer pinned at the bottom with the access strip as its top edge (connection, access level, approval mode) and one control row (attach, model, usage, send). Full page: history rail left, dialog centred at reading measure, results shelf right.

FORM: Dialog mit Ergebnisablage, position 3 of 7 on the ordered list, seed key efd8cb31. Signature: the work line whose stations are the agent's steps; approvals are interchange stations that stay as "Erlaubt"/"Abgelehnt" records.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
