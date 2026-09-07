import { useNavigate } from "@tanstack/react-router";
import { PencilIcon, SettingsIcon, TrashIcon, WrenchIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ObjectDropDialog } from "@/features/object-admin/object-drop-dialog";
import { ObjectRenameDialog } from "@/features/object-admin/object-rename-dialog";
import { useActiveConnection } from "@/lib/connections";
import type { ObjectAdminType } from "@/lib/db";
import { supports } from "@/lib/providers";
import { useTableTabs } from "@/lib/table-tabs";

interface ObjectAdminMenuProps {
  schema: string;
  name: string;
  objectType: ObjectAdminType;
  showAlter?: boolean;
}

export function ObjectAdminMenu({
  schema,
  name,
  objectType,
  showAlter = true,
}: ObjectAdminMenuProps) {
  const connection = useActiveConnection();
  const navigate = useNavigate();
  const openTab = useTableTabs((state) => state.openTab);
  const openAlterTableTab = useTableTabs((state) => state.openAlterTableTab);
  const [dropOpen, setDropOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  if (!connection || !supports(connection, "object_admin")) return null;

  const canAlter = showAlter && objectType === "table" && supports(connection, "alter_columns");

  const handleRenamed = (newName: string) => {
    openTab({ schema, table: newName, entityType: objectType === "table" ? "table" : "view" });
    void navigate({
      to: "/tables/$schema/$table",
      params: { schema, table: newName },
      search: objectType === "table" ? {} : { type: "view" },
    });
  };

  const handleDropped = () => {
    void navigate({ to: "/" });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2.5 text-xs">
            <SettingsIcon className="size-3.5" />
            Objekt
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setRenameOpen(true)}>
            <PencilIcon className="size-3.5" />
            Umbenennen…
          </DropdownMenuItem>
          {canAlter && (
            <DropdownMenuItem
              onClick={() => {
                openAlterTableTab({ schema, table: name });
                void navigate({
                  to: "/alter-table/$schema/$table",
                  params: { schema, table: name },
                });
              }}
            >
              <WrenchIcon className="size-3.5" />
              Struktur ändern…
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setDropOpen(true)}>
            <TrashIcon className="size-3.5" />
            Löschen…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ObjectRenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        schema={schema}
        name={name}
        objectType={objectType}
        onRenamed={handleRenamed}
      />
      <ObjectDropDialog
        open={dropOpen}
        onOpenChange={setDropOpen}
        schema={schema}
        name={name}
        objectType={objectType}
        onDropped={handleDropped}
      />
    </>
  );
}
