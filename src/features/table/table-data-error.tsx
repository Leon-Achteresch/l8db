import { TriangleAlertIcon } from "lucide-react";

interface TableDataErrorProps {
  title: string;
  error: unknown;
}

export function TableDataError({ title, error }: TableDataErrorProps) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 border-t border-border bg-background">
      <div className="flex flex-col items-center gap-3 max-w-md text-center p-6 rounded-lg border border-destructive/20 bg-destructive/5 shadow-xs">
        <TriangleAlertIcon className="size-8 text-destructive animate-bounce" />
        <h3 className="text-sm font-semibold text-destructive">{title}</h3>
        <p className="text-xs text-muted-foreground font-mono bg-destructive/[0.02] p-2.5 rounded border border-destructive/10 break-all select-text">
          {String(error)}
        </p>
      </div>
    </div>
  );
}
