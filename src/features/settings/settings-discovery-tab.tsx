import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
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
import { Switch } from "@/components/ui/switch";
import { DISCOVERY_CHANNEL_ROWS } from "@/features/settings/discovery-channel-rows";
import { DiscoverySettingsSlot } from "@/features/settings/discovery-settings-slot";
import { DISCOVERY_SETTINGS_SLOTS } from "@/features/settings/discovery-settings-slots";
import { SettingsRow } from "@/features/settings/settings-row";
import { useSettingsStore } from "@/lib/settings";

async function resetProgress() {
  try {
    const { resetDiscoveryProgress } = await import("@/lib/discovery/usage");
    const { resetCoordinatorSession } = await import("@/lib/discovery/coordinator");
    resetDiscoveryProgress();
    resetCoordinatorSession();
    toast.success("Fortschritt zurückgesetzt");
  } catch (error) {
    toast.error("Zurücksetzen fehlgeschlagen", { description: String(error) });
  }
}

export function SettingsDiscoveryTab() {
  const discovery = useSettingsStore((state) => state.discovery);
  const setDiscovery = useSettingsStore((state) => state.setDiscovery);

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold tracking-tight">Tipps & Hinweise</h2>

      <SettingsRow settingId="discovery" featureId="settings.discovery">
        <Switch
          checked={discovery.enabled}
          onCheckedChange={(enabled) => setDiscovery({ enabled })}
          aria-label="Funktionen entdecken"
        />
      </SettingsRow>

      <div
        className="space-y-1 rounded-xl bg-muted/40 p-2"
        data-feature="settings.discovery.channels"
      >
        {DISCOVERY_CHANNEL_ROWS.map((row) => (
          <SettingsRow key={row.channel} title={row.title}>
            <Switch
              checked={discovery.enabled && discovery.channels[row.channel]}
              disabled={!discovery.enabled}
              onCheckedChange={(checked) =>
                setDiscovery({ channels: { ...discovery.channels, [row.channel]: checked } })
              }
              aria-label={row.title}
            />
          </SettingsRow>
        ))}
      </div>

      {DISCOVERY_SETTINGS_SLOTS.map((slot) => (
        <DiscoverySettingsSlot key={slot.id} slot={slot} />
      ))}

      <SettingsRow settingId="discovery-reset">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm">
              <RotateCcw />
              Zurücksetzen
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Fortschritt zurücksetzen?</AlertDialogTitle>
              <AlertDialogDescription>
                Genutzte Funktionen und gezeigte Hinweise werden vergessen.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction onClick={() => void resetProgress()}>
                Zurücksetzen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SettingsRow>
    </div>
  );
}
