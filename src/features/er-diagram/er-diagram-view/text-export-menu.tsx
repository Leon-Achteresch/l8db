import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { ClipboardCopy, Download, FileCode2 } from "lucide-react";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyText } from "@/lib/clipboard";
import type { ERSchema } from "@/lib/db";
import { toDbml, toMermaid } from "@/lib/er-text-export";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { onHotkeyAction } from "@/lib/hotkeys";

const FORMATS = [
  { id: "mermaid", label: "Mermaid", extension: "mmd", render: toMermaid },
  { id: "dbml", label: "DBML", extension: "dbml", render: toDbml },
] as const;

type Format = (typeof FORMATS)[number];

export function TextExportMenu({ schema }: { schema: ERSchema }) {
  const feature = useNewFeatureVisibility<HTMLButtonElement>("er-diagram.text-export");
  const empty = schema.tables.length === 0;

  const copy = async (format: Format) => {
    try {
      await copyText(format.render(schema));
      toast.success(`${format.label} in die Zwischenablage kopiert`);
    } catch (error) {
      toast.error(`Kopieren fehlgeschlagen: ${String(error)}`);
    }
  };

  const store = useCallback(
    async (format: Format) => {
      try {
        const filePath = await save({
          title: `ER-Diagramm als ${format.label} speichern`,
          defaultPath: `er-diagramm.${format.extension}`,
          filters: [{ name: format.label, extensions: [format.extension] }],
        });
        if (!filePath) return;
        await writeTextFile(filePath, format.render(schema));
        toast.success(`${format.label} gespeichert`);
      } catch (error) {
        toast.error(`Speichern fehlgeschlagen: ${String(error)}`);
      }
    },
    [schema],
  );

  useEffect(() => {
    const stop = FORMATS.map((format) =>
      onHotkeyAction(`er.export.${format.id}`, () => {
        if (!empty) void store(format);
      }),
    );
    return () => {
      for (const dispose of stop) dispose();
    };
  }, [empty, store]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          ref={feature.ref}
          type="button"
          disabled={empty}
          className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground shadow-sm transition-colors hover:bg-accent/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          title="Als Mermaid oder DBML exportieren"
        >
          <FileCode2 className="size-3.5" />
          Mermaid/DBML
          {feature.isNew && <NewBadge />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {FORMATS.map((format, index) => (
          <div key={format.id}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs">{format.label}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => void copy(format)}>
              <ClipboardCopy className="size-3.5" />
              Kopieren
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void store(format)}>
              <Download className="size-3.5" />
              Als .{format.extension} speichern
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
