import { Spinner } from "@/components/ui/spinner";
import { queryErrorMessage } from "@/lib/connection-url";

export function SidebarQueryError({ error }: { error: unknown }) {
  const message = queryErrorMessage(error);
  if (!message) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        Verbinde…
      </div>
    );
  }
  return <p className="py-1 text-sm text-destructive">{message}</p>;
}
