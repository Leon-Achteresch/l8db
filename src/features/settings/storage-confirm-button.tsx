import { Trash2 } from "lucide-react";
import { IconButton } from "@/components/icon-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface Props {
  label: string;
  title: string;
  description?: string;
  confirm: string;
  onConfirm: () => void;
  iconOnly?: boolean;
}

export function StorageConfirmButton({
  label,
  title,
  description,
  confirm,
  onConfirm,
  iconOnly,
}: Props) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {iconOnly ? (
          <IconButton
            aria-label={label}
            size="icon-xs"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 />
          </IconButton>
        ) : (
          <Button
            size="xs"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 />
            {label}
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
