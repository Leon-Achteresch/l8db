import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProviderInfo } from "@/lib/db";
import { ConnectionField } from "../connection-field";

export function ConnectionFileInput({
  info,
  file,
  setFile,
  pickFile,
}: {
  info: ProviderInfo;
  file: string;
  setFile: (value: string) => void;
  pickFile: () => Promise<void>;
}) {
  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <ConnectionField
          id="connection-file"
          label="Datenbankdatei"
          placeholder={info.placeholder}
          value={file}
          onChange={(event) => setFile(event.target.value)}
          spellCheck={false}
        />
      </div>
      <Button type="button" variant="outline" className="h-10" onClick={() => void pickFile()}>
        <FolderOpen className="size-4" />
        Durchsuchen
      </Button>
    </div>
  );
}
