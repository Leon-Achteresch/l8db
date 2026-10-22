import { Copy, Download, Eye, Link, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyWithToast } from "@/lib/clipboard";
import type { ConvexStoredFile } from "@/lib/db/convex-studio-files";
import { formatBytes } from "../../supabase-studio/storage/storage-format";

export function ConvexFilesTable({
  files,
  selected,
  active,
  onToggle,
  onToggleAll,
  onPreview,
  onDownload,
  onDelete,
}: {
  files: ConvexStoredFile[];
  selected: Set<string>;
  active: string | null;
  onToggle: (id: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onPreview: (file: ConvexStoredFile) => void;
  onDownload: (file: ConvexStoredFile) => void;
  onDelete: (file: ConvexStoredFile) => void;
}) {
  const allSelected = files.length > 0 && files.every((file) => selected.has(file.id));
  return (
    <table className="w-full text-xs">
      <thead className="border-b bg-muted/40 text-left text-muted-foreground">
        <tr>
          <th className="w-8 px-3 py-2">
            <Checkbox
              aria-label="Alle auswählen"
              checked={allSelected}
              onCheckedChange={(checked) => onToggleAll(checked === true)}
            />
          </th>
          <th className="w-full px-2 py-2 font-medium">Storage-ID</th>
          <th className="px-2 py-2 font-medium">Größe</th>
          <th className="px-2 py-2 font-medium">Typ</th>
          <th className="px-2 py-2 font-medium">SHA-256</th>
          <th className="px-2 py-2 font-medium">Erstellt</th>
          <th className="w-8 px-2 py-2" />
        </tr>
      </thead>
      <tbody className="divide-y">
        {files.map((file) => (
          <tr key={file.id} className={active === file.id ? "bg-primary/5" : "hover:bg-muted/40"}>
            <td className="px-3 py-1.5">
              <Checkbox
                aria-label={`${file.id} auswählen`}
                checked={selected.has(file.id)}
                onCheckedChange={(checked) => onToggle(file.id, checked === true)}
              />
            </td>
            <td className="max-w-0 px-2 py-1.5">
              <button
                type="button"
                className="block w-full truncate text-left font-mono hover:text-primary"
                onClick={() => onPreview(file)}
                title={file.id}
              >
                {file.id}
              </button>
            </td>
            <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
              {formatBytes(file.size)}
            </td>
            <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
              {file.contentType ?? "–"}
            </td>
            <td
              className="max-w-32 truncate px-2 py-1.5 font-mono text-muted-foreground"
              title={file.sha256 ?? undefined}
            >
              {file.sha256 ?? "–"}
            </td>
            <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
              {new Date(file.creationTime).toLocaleString("de-DE")}
            </td>
            <td className="px-2 py-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`Aktionen für ${file.id}`}>
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onPreview(file)}>
                    <Eye className="size-3.5" /> Vorschau
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onDownload(file)}>
                    <Download className="size-3.5" /> Herunterladen
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void copyWithToast(file.id, "Storage-ID")}>
                    <Copy className="size-3.5" /> Storage-ID kopieren
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!file.url}
                    onSelect={() => file.url && void copyWithToast(file.url, "Datei-URL")}
                  >
                    <Link className="size-3.5" /> URL kopieren
                  </DropdownMenuItem>
                  {file.sha256 && (
                    <DropdownMenuItem
                      onSelect={() => file.sha256 && void copyWithToast(file.sha256, "SHA-256")}
                    >
                      <Copy className="size-3.5" /> SHA-256 kopieren
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => onDelete(file)}>
                    <Trash2 className="size-3.5" /> Löschen
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
