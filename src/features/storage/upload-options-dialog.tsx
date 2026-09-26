import { FolderInputIcon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ObjectProperties } from "@/lib/db";
import { ObjectPropertiesFields } from "./object-properties-fields";

export function UploadOptionsDialog({
  open,
  prefix,
  onOpenChange,
  onUpload,
}: {
  open: boolean;
  prefix: string;
  onOpenChange: (open: boolean) => void;
  onUpload: (directory: boolean, properties: ObjectProperties) => void;
}) {
  const [properties, setProperties] = useState<ObjectProperties>({ metadata: {} });
  const start = (directory: boolean) => {
    onOpenChange(false);
    onUpload(directory, properties);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Hochladen mit Optionen</DialogTitle>
          <DialogDescription>
            Ziel: {prefix || "/"}. Die Einstellungen gelten für alle gewählten Dateien; ohne
            Content-Type wird er aus der Endung erkannt.
          </DialogDescription>
        </DialogHeader>
        <ObjectPropertiesFields value={properties} onChange={setProperties} />
        <DialogFooter>
          <Button variant="outline" onClick={() => start(true)}>
            <FolderInputIcon /> Ordner wählen…
          </Button>
          <Button onClick={() => start(false)}>
            <UploadIcon /> Dateien wählen…
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
