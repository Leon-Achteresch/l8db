import { BellIcon } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useQueryQolSettings } from "@/lib/query-qol-settings";

export function QueryNotificationToggle() {
  const enabled = useQueryQolSettings((s) => s.notifications);
  const setEnabled = useQueryQolSettings((s) => s.setNotifications);
  const feature = useNewFeatureVisibility<HTMLButtonElement>("query.notifications");
  return (
    <Button
      ref={feature.ref}
      size="sm"
      variant={enabled ? "secondary" : "ghost"}
      className="h-7 gap-1.5 px-2 text-xs"
      aria-label="Desktop-Meldungen für lange Abfragen"
      aria-pressed={enabled}
      title="Bei Erfolg oder Fehler nach mindestens 10 Sekunden im Hintergrund benachrichtigen; ohne SQL oder Daten"
      onClick={() => setEnabled(!enabled)}
    >
      <BellIcon className="size-3.5" />
      <span className="sr-only @min-[64rem]/qtb:not-sr-only">Meldungen</span>
      {feature.isNew && <NewBadge />}
    </Button>
  );
}
