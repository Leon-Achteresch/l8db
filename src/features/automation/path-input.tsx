import { open, save } from "@tauri-apps/plugin-dialog";
import { FolderOpenIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/automation/toast";
import { TemplateInput } from "./template-input";

interface Props extends Omit<ComponentProps<typeof TemplateInput>, "mono"> {
  mode: "open" | "save" | "directory";
  extensions?: string[];
}

export function PathInput({ mode, extensions, value, onChange, ...rest }: Props) {
  const browse = async () => {
    try {
      const filters = extensions?.length ? [{ name: "Dateien", extensions }] : undefined;
      const picked =
        mode === "save"
          ? await save({ defaultPath: value || undefined, filters })
          : await open({
              directory: mode === "directory",
              multiple: false,
              defaultPath: value || undefined,
              filters,
            });
      if (typeof picked === "string") onChange(picked);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex min-w-0 gap-1.5">
      <div className="min-w-0 flex-1">
        <TemplateInput {...rest} value={value} onChange={onChange} mono />
      </div>
      <Button type="button" variant="outline" onClick={() => void browse()} className="shrink-0">
        <FolderOpenIcon />
        Durchsuchen …
      </Button>
    </div>
  );
}
