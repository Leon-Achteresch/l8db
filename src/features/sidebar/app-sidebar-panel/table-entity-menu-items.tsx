import { Star, StarOff } from "lucide";
import {
  CopyIcon,
  FileCodeIcon,
  NetworkIcon,
  SquareTerminalIcon,
  TrashIcon,
  WrenchIcon,
} from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import type { useActiveCapabilities } from "@/lib/db-selection";
import type { EntityConfirmAction } from "./entity-confirm-dialog";

interface TableEntityMenuItemsProps {
  schema: string;
  name: string;
  caps: ReturnType<typeof useActiveCapabilities>;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onOpenInEditor: () => void;
  onScriptTable: () => void;
  onCopy: () => void;
  onAlterTable: () => void;
  onFocusInErDiagram: () => void;
  onConfirm: (action: EntityConfirmAction) => void;
}

export function TableEntityMenuItems({
  schema,
  name,
  caps,
  isFavorite,
  onToggleFavorite,
  onOpenInEditor,
  onScriptTable,
  onCopy,
  onAlterTable,
  onFocusInErDiagram,
  onConfirm,
}: TableEntityMenuItemsProps) {
  return (
    <>
      <ContextMenuItem onSelect={onToggleFavorite}>
        <MorphIcon icon={isFavorite ? StarOff : Star} />
        {isFavorite ? "Favorit lösen" : "Anheften"}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={onOpenInEditor}>
        <SquareTerminalIcon />
        Im Editor öffnen
      </ContextMenuItem>
      {caps.table_script && (
        <ContextMenuItem onSelect={onScriptTable}>
          <FileCodeIcon />
          CREATE-Skript erstellen
        </ContextMenuItem>
      )}
      {caps.schema_object_copy && (
        <ContextMenuItem onSelect={onCopy}>
          <CopyIcon />
          In anderem Schema erstellen
        </ContextMenuItem>
      )}
      {caps.alter_columns && (
        <ContextMenuItem onSelect={onAlterTable}>
          <WrenchIcon />
          Alter Table
        </ContextMenuItem>
      )}
      {caps.foreign_keys && (
        <ContextMenuItem onSelect={onFocusInErDiagram}>
          <NetworkIcon />
          Im ER-Diagramm fokussieren
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        variant="destructive"
        onSelect={() =>
          onConfirm({
            kind: "truncate",
            schema: schema,
            name: name,
          })
        }
      >
        <TrashIcon />
        {caps.query_language === "redis" ? "Alle Keys löschen" : "Delete All Rows"}
      </ContextMenuItem>
      {caps.query_language !== "redis" && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() =>
              onConfirm({
                kind: "drop",
                schema: schema,
                name: name,
              })
            }
          >
            <TrashIcon />
            Drop Table
          </ContextMenuItem>
        </>
      )}
    </>
  );
}
