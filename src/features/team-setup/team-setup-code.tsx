import { ClipboardCopyIcon, DownloadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { saveBytesToFile } from "@/lib/value-viewers/binary-file";

export function TeamSetupCode({
  title,
  file,
  text,
}: {
  title: string;
  file: string;
  text: string;
}) {
  const download = async () => {
    try {
      if (await saveBytesToFile(new TextEncoder().encode(text), file))
        toast.success(`${file} gespeichert`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-1.5">
        <span className="min-w-48 flex-1 text-xs font-medium">{title}</span>
        <Button size="sm" variant="ghost" onClick={() => void copyText(text, `${file} kopiert`)}>
          <ClipboardCopyIcon className="size-3.5" />
          <span>Kopieren</span>
        </Button>
        <Button size="sm" variant="outline" onClick={() => void download()}>
          <DownloadIcon className="size-3.5" />
          <span>{file} herunterladen</span>
        </Button>
      </div>
      <pre className="max-h-64 overflow-auto bg-background p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
        {text}
      </pre>
    </div>
  );
}
