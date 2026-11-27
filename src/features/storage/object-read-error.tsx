import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { errorText } from "./use-storage-connection";

export function ObjectReadError({
  error,
  onRetry,
  busy,
}: {
  error: unknown;
  onRetry: () => void;
  busy: boolean;
}) {
  const feature = useNewFeatureVisibility<HTMLButtonElement>("storage.objects.retry-read");
  return (
    <div className="grid justify-items-start gap-2">
      <p role="alert" className="text-sm break-words text-destructive">
        {errorText(error)}
      </p>
      <Button ref={feature.ref} size="xs" variant="outline" onClick={onRetry} disabled={busy}>
        Erneut versuchen
        {feature.isNew && <NewBadge />}
      </Button>
    </div>
  );
}
