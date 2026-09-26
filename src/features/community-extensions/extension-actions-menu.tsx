import { EllipsisIcon, PowerOffIcon, RefreshCwIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ExtensionDescriptor } from "@/lib/extensions/contracts";

const item = "rounded-lg whitespace-nowrap first:rounded-lg last:rounded-lg";

export function ExtensionActionsMenu({
  extension,
  onDisable,
  onReload,
  onUpdate,
  onUninstall,
}: {
  extension: ExtensionDescriptor;
  onDisable: () => void;
  onReload: () => void;
  onUpdate: () => void;
  onUninstall: () => void;
}) {
  const { manifest } = extension.archive;
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Weitere Aktionen für ${manifest.name}`}
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-56">
          <DropdownMenuLabel className="truncate">
            {manifest.name} · v{manifest.version}
          </DropdownMenuLabel>
          {extension.enabled && (
            <DropdownMenuItem className={item} onSelect={onDisable}>
              <PowerOffIcon />
              Deaktivieren
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className={item} onSelect={onReload}>
            <RefreshCwIcon />
            Neu laden
          </DropdownMenuItem>
          {!extension.developmentPath && (
            <DropdownMenuItem className={item} onSelect={onUpdate}>
              <UploadIcon />
              Aus Datei aktualisieren …
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator className="my-1" />
          <DropdownMenuItem
            className={item}
            variant="destructive"
            onSelect={() => setConfirm(true)}
          >
            <Trash2Icon />
            Deinstallieren …
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{manifest.name} deinstallieren?</AlertDialogTitle>
            <AlertDialogDescription>
              Die Erweiterung wird samt Einstellungen und eigenem Speicher entfernt. Deine
              Verbindungen bleiben erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onUninstall}>
              Deinstallieren
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
