import { CopyAsMenu } from "@/components/copy-as-menu";
import { ToolsMenu } from "@/components/tools-menu";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";
import { CompareObjectMenuItem } from "@/features/sidebar/compare-object-menu-item";
import { formatMenuShortcut, MENU_KEYS } from "@/lib/hotkeys";
import { SQL_TEMPLATE_LABELS } from "@/lib/sql-templates";
import type { SidebarEntityActions } from "./use-sidebar-entity-actions";

interface EntityMenuItemsProps {
  type: "table" | "view";
  schema: string;
  name: string;
  actions: SidebarEntityActions;
  onRename?: () => void;
  onDrop?: () => void;
  onCopyToSchema: () => void;
  onCopyToConnection: () => void;
}

export function EntityMenuItems({
  type,
  schema,
  name,
  actions,
  onRename,
  onDrop,
  onCopyToSchema,
  onCopyToConnection,
}: EntityMenuItemsProps) {
  const { caps } = actions;
  const table = type === "table";
  const sql = caps.query_language === "sql";
  const script = table && caps.table_script;
  const templates = table ? (["select", "insert", "update"] as const) : (["select"] as const);

  return (
    <>
      <ContextMenuItem onSelect={() => actions.openEntity(schema, name)}>
        Öffnen
        <ContextMenuShortcut>{formatMenuShortcut(MENU_KEYS.open)}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => actions.openInNewTab(schema, name)}>
        In neuem Tab öffnen
        <ContextMenuShortcut>{formatMenuShortcut(MENU_KEYS.openInNewTab)}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => actions.handleOpenInEditor(schema, name)}>
        <span className="max-w-60 truncate">Neue Abfrage für {name}</span>
        <ContextMenuShortcut>{formatMenuShortcut(MENU_KEYS.newQuery)}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <CopyAsMenu
        name={name}
        qualifiedName={actions.qualifiedName(schema, name)}
        shortcuts
        featureId="sidebar.object-menu"
      >
        {(sql || script) && (
          <>
            {sql &&
              templates.map((template) => (
                <ContextMenuItem
                  key={template}
                  onSelect={() => void actions.handleCopySql(schema, name, template)}
                >
                  {SQL_TEMPLATE_LABELS[template]}
                </ContextMenuItem>
              ))}
            {script && (
              <ContextMenuItem onSelect={() => void actions.handleScriptTable(schema, name, true)}>
                CREATE-Skript
              </ContextMenuItem>
            )}
            {sql && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onSelect={() => void actions.handleCopySql(schema, name, "columns")}
                >
                  {SQL_TEMPLATE_LABELS.columns}
                </ContextMenuItem>
              </>
            )}
          </>
        )}
      </CopyAsMenu>
      <ContextMenuItem onSelect={() => actions.handleExport(schema, name)}>
        Exportieren…
      </ContextMenuItem>
      {table && caps.csv_import && (
        <ContextMenuItem onSelect={() => actions.handleImport(schema, name)}>
          Importieren…
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      {table && caps.alter_columns && (
        <ContextMenuItem onSelect={() => actions.handleAlterTable(schema, name)}>
          Struktur bearbeiten…
        </ContextMenuItem>
      )}
      {onRename && (
        <ContextMenuItem onSelect={onRename}>
          Umbenennen
          <ContextMenuShortcut>{formatMenuShortcut(MENU_KEYS.rename)}</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      <ContextMenuItem onSelect={() => actions.toggleFavoriteObject(schema, name)}>
        {actions.isFavorite(schema, name) ? "Aus Favoriten entfernen" : "Zu Favoriten hinzufügen"}
      </ContextMenuItem>
      <ToolsMenu>
        <CompareObjectMenuItem schema={schema} name={name} objectType={type} />
        {table && caps.foreign_keys && (
          <ContextMenuItem onSelect={() => actions.handleFocusInErDiagram(schema, name)}>
            Im ER-Diagramm zeigen
          </ContextMenuItem>
        )}
        {script && (
          <ContextMenuItem onSelect={() => void actions.handleScriptTable(schema, name)}>
            CREATE-Skript im Editor öffnen
          </ContextMenuItem>
        )}
        {caps.schema_object_copy && (
          <ContextMenuItem onSelect={onCopyToSchema}>In anderem Schema erstellen…</ContextMenuItem>
        )}
        {table && caps.table_copy && (
          <ContextMenuItem onSelect={onCopyToConnection}>
            In andere Verbindung kopieren…
          </ContextMenuItem>
        )}
      </ToolsMenu>
      {(table || onDrop) && <ContextMenuSeparator />}
      {table && (
        <ContextMenuItem
          variant="destructive"
          onSelect={() => actions.setConfirmAction({ kind: "truncate", schema, name })}
        >
          {caps.query_language === "redis" ? "Alle Keys löschen…" : "Alle Zeilen löschen…"}
        </ContextMenuItem>
      )}
      {onDrop && (
        <ContextMenuItem variant="destructive" onSelect={onDrop}>
          {table ? "Tabelle löschen…" : "View löschen…"}
          <ContextMenuShortcut>{formatMenuShortcut(MENU_KEYS.drop)}</ContextMenuShortcut>
        </ContextMenuItem>
      )}
    </>
  );
}
