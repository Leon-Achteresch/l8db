import { EllipsisIcon, PowerOffIcon, RefreshCwIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { IconMenu, IconMenuContent, IconMenuItem, IconMenuSeparator } from "@/components/icon-menu";
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
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ExtensionDescriptor } from "@/lib/extensions/contracts";

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
      <IconMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Weitere Aktionen für ${manifest.name}`}
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <IconMenuContent>
          {extension.enabled && (
            <IconMenuItem icon={<PowerOffIcon />} label="Deaktivieren" onSelect={onDisable} />
          )}
          <IconMenuItem icon={<RefreshCwIcon />} label="Neu laden" onSelect={onReload} />
          {!extension.developmentPath && (
            <IconMenuItem
              icon={<UploadIcon />}
              label="Aus Datei aktualisieren …"
              onSelect={onUpdate}
            />
          )}
          <IconMenuSeparator />
          <IconMenuItem
            icon={<Trash2Icon />}
            label="Deinstallieren …"
            variant="destructive"
            onSelect={() => setConfirm(true)}
          />
        </IconMenuContent>
      </IconMenu>
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
