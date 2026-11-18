import { useId, useState } from "react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  isSqlFileReadEncoding,
  SQL_FILE_READ_OPTIONS,
  type SqlFileReadEncoding,
} from "@/lib/sql-file";
import type { QueryFileEncodingAction } from "./use-query-file-actions";

type Props = {
  action: QueryFileEncodingAction;
  dirty: boolean;
  initial: SqlFileReadEncoding;
  onClose: () => void;
  onRead: (encoding: SqlFileReadEncoding) => void;
};

export function QueryFileEncodingDialog({ action, dirty, initial, onClose, onRead }: Props) {
  const id = useId();
  const [encoding, setEncoding] = useState(initial);
  const reload = action === "reload";
  const discard = reload && dirty;
  const title = reload ? "Datei mit Kodierung neu laden" : "SQL-Datei mit Kodierung öffnen";

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] gap-4 overflow-y-auto p-4 sm:p-5">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-balance">{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {discard
              ? "Beim Neuladen werden ungesicherte Änderungen verworfen."
              : "Für Dateien in einer anderen Kodierung speichert l8db eine neue UTF-8-Kopie."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <RadioGroup
          value={encoding}
          onValueChange={(value) => isSqlFileReadEncoding(value) && setEncoding(value)}
          aria-label="Lesekodierung"
          orientation="vertical"
          className="gap-1"
        >
          {SQL_FILE_READ_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/40"
              htmlFor={`${id}-${option.value}`}
            >
              <RadioGroupItem value={option.value} id={`${id}-${option.value}`} />
              {option.label}
            </label>
          ))}
        </RadioGroup>
        <AlertDialogFooter>
          <AlertDialogCancel>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            variant={discard ? "destructive" : "default"}
            onClick={() => onRead(encoding)}
          >
            {discard ? "Verwerfen und neu laden" : reload ? "Neu laden" : "Datei auswählen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
