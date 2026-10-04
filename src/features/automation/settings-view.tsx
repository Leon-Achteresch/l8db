import { Skeleton } from "@/components/ui/skeleton";
import { SettingsBackgroundSection } from "./settings-background-section";
import { SettingsSchedulerSection } from "./settings-scheduler-section";
import { SettingsSmtpSection } from "./settings-smtp-section";
import { SettingsWebhooksSection } from "./settings-webhooks-section";
import { useAutomationSettings } from "./use-automation-settings";

export function AutomationSettingsView() {
  const { settings, error, update, save } = useAutomationSettings();

  return (
    <div data-testid="automation-settings" className="h-full min-h-0 overflow-y-auto">
      <div className="@container mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-6">
        {settings ? (
          <>
            <SettingsSchedulerSection settings={settings} update={(patch) => void update(patch)} />
            <SettingsBackgroundSection />
            <SettingsSmtpSection settings={settings} update={save} />
            <SettingsWebhooksSection settings={settings} update={save} />
          </>
        ) : error ? (
          <p className="text-sm text-destructive">{String(error)}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}
      </div>
    </div>
  );
}
