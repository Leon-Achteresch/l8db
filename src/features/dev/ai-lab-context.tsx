import { Check, Database, FileCode2, Search, Wrench } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AiContextChips } from "@/features/ai/ai-context-chips";
import { cn } from "@/lib/utils";
import { AI_LAB_CONTEXT } from "./ai-lab-data";

const options = [
  ...AI_LAB_CONTEXT.map((item) => ({
    id: item.id,
    title: item.label,
    detail: item.kind === "table" ? `public.${item.table}` : "Markierte SQL-Zeilen",
    category: item.kind === "table" ? "data" : "editor",
  })),
  { id: "skill", title: "SQL Review", detail: "Lokaler Skill", category: "tools" },
  { id: "docs", title: "Dokumentation", detail: "Externer MCP · 8 Werkzeuge", category: "tools" },
];

export function AiLabContext() {
  const [selected, setSelected] = useState(["orders", "customers", "skill"]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("data");
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  return (
    <section
      aria-label="Kontextvorschau"
      className="grid h-full min-h-0 overflow-auto @min-[760px]:grid-cols-[minmax(0,1fr)_340px]"
    >
      <div className="space-y-6 p-6 sm:p-10">
        <Badge variant="outline">Kontext für dieses Gespräch</Badge>
        <h3 className="max-w-lg text-3xl font-semibold tracking-tight">
          Die KI weiß, woran du arbeitest.
        </h3>
        <p className="max-w-lg text-sm leading-7 text-muted-foreground">
          Du bestimmst, welche Tabellen, SQL-Zeilen und Werkzeuge in die nächste Nachricht gehören.
        </p>
        <div className="space-y-4 rounded-xl border bg-card p-5">
          <h4 className="text-sm font-medium">Ausgewählter Kontext</h4>
          <AiContextChips
            items={AI_LAB_CONTEXT.filter((item) => selected.includes(item.id))}
            onRemove={toggle}
          />
          <div className="flex flex-wrap gap-2">
            {options
              .filter((item) => item.category === "tools" && selected.includes(item.id))
              .map((item) => (
                <Badge key={item.id} variant="secondary">
                  {item.title}
                </Badge>
              ))}
          </div>
          <p className="text-xs leading-6 text-muted-foreground">
            Tabellenbeschreibungen und gewählte SQL-Zeilen. Datenzeilen werden erst durch
            freigegebene Werkzeuge gelesen.
          </p>
        </div>
        <details open className="rounded-xl border bg-muted/20 p-5">
          <summary className="cursor-pointer text-xs font-medium">
            Vorschau des ausgewählten Kontexts
          </summary>
          <pre className="mt-4 whitespace-pre-wrap font-mono text-[11px] leading-6 text-muted-foreground">{`Verbindung: Shop · PostgreSQL\nSchema: public\n${options
            .filter((item) => selected.includes(item.id))
            .map((item) => `${item.title}: ${item.detail}`)
            .join("\n")}`}</pre>
        </details>
        <p className="text-xs leading-6 text-muted-foreground">
          Beispielvorschau. Zugangsdaten gehören nicht in den Modellkontext. Externe Werkzeuge
          können Daten an weitere Dienste senden.
        </p>
      </div>
      <aside className="space-y-5 border-t bg-muted/20 p-5 @min-[760px]:border-t-0 @min-[760px]:border-l">
        <h4 className="text-sm font-semibold">Kontext auswählen</h4>
        <div className="relative">
          <Search className="absolute top-2.5 left-3 size-3.5 text-muted-foreground" />
          <Input
            aria-label="Kontext durchsuchen"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tabellen, Dateien, Werkzeuge …"
            className="pl-9 text-xs"
          />
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList variant="line" aria-label="Kontextkategorie">
            <TabsTrigger value="data">
              <Database className="size-3" /> Daten
            </TabsTrigger>
            <TabsTrigger value="editor">
              <FileCode2 className="size-3" /> Editor
            </TabsTrigger>
            <TabsTrigger value="tools">
              <Wrench className="size-3" /> Tools
            </TabsTrigger>
          </TabsList>
          {["data", "editor", "tools"].map((category) => (
            <TabsContent key={category} value={category} className="space-y-2 pt-3">
              {options
                .filter(
                  (item) =>
                    item.category === category &&
                    `${item.title} ${item.detail}`.toLowerCase().includes(query.toLowerCase()),
                )
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={selected.includes(item.id)}
                    onClick={() => toggle(item.id)}
                    className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left outline-none hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      className={cn(
                        "grid size-4 shrink-0 place-items-center rounded border",
                        selected.includes(item.id) &&
                          "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      {selected.includes(item.id) && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-medium">{item.title}</span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {item.detail}
                      </span>
                    </span>
                  </button>
                ))}
            </TabsContent>
          ))}
        </Tabs>
        <p className="text-[11px] leading-6 text-muted-foreground">
          Die Auswahl gilt nur in dieser Vorschau und wird nicht gespeichert.
        </p>
      </aside>
    </section>
  );
}
