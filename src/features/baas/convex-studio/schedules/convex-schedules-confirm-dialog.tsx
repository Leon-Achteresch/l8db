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

export interface ConvexSchedulesConfirm {
  title: string;
  description: string;
  action: string;
  destructive: boolean;
  run: () => Promise<unknown>;
}

export function ConvexSchedulesConfirmDialog({
  confirm,
  busy,
  onConfirm,
  onClose,
}: {
  confirm: ConvexSchedulesConfirm | null;
  busy: boolean;
  onConfirm: (confirm: ConvexSchedulesConfirm) => void;
  onClose: () => void;
}) {
  return (
    <AlertDialog
      open={confirm !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant={confirm?.destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              if (confirm) onConfirm(confirm);
            }}
          >
            {busy ? "Bitte warten…" : confirm?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
