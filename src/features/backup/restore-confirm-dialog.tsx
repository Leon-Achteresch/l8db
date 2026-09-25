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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface RestoreConfirmDialogProps {
  open: boolean;
  connectionName: string;
  endpoint: string;
  database: string | null;
  source: string;
  effects: string[];
  phrase: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RestoreConfirmDialog({
  open,
  connectionName,
  endpoint,
  database,
  source,
  effects,
  phrase,
  onCancel,
  onConfirm,
}: RestoreConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === phrase;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setTyped("");
          onCancel();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Wiederherstellung bestätigen</AlertDialogTitle>
          <AlertDialogDescription>
            Die Sicherung wird in das folgende Ziel eingespielt. Vorhandene Daten können
            überschrieben oder gelöscht werden.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
          <dt className="text-muted-foreground">Verbindung</dt>
          <dd className="font-medium">{connectionName}</dd>
          <dt className="text-muted-foreground">Server</dt>
          <dd className="font-mono break-all">{endpoint}</dd>
          <dt className="text-muted-foreground">Datenbank</dt>
          <dd className="font-mono font-medium">{database ?? "Standard"}</dd>
          <dt className="text-muted-foreground">Quelle</dt>
          <dd className="font-mono break-all">{source}</dd>
        </dl>
        {effects.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-destructive">
            {effects.map((effect) => (
              <li key={effect}>{effect}</li>
            ))}
          </ul>
        )}
        <div className="grid gap-1">
          <Label htmlFor="restore-confirm-input" className="text-xs">
            Zur Bestätigung <span className="font-mono font-semibold">{phrase}</span> eingeben
          </Label>
          <Input
            id="restore-confirm-input"
            value={typed}
            autoComplete="off"
            className="h-8 font-mono text-xs"
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!matches}
            onClick={() => {
              setTyped("");
              onConfirm();
            }}
          >
            Wiederherstellen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
