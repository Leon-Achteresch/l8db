import { MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { openExternal } from "@/lib/discovery/labs/feedback";
import {
  LABS,
  type LabEntry,
  labEnabled,
  labFeedbackUrl,
  labLocked,
  setLab,
} from "@/lib/discovery/labs/labs";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useOrganizationStore } from "@/lib/organization-state";
import { useSettingsStore } from "@/lib/settings";
import { getAppVersion } from "@/lib/updater";

async function feedback(lab: LabEntry, version: string | null) {
  if (!(await openExternal(labFeedbackUrl(lab, version))))
    toast.error("Browser konnte nicht geöffnet werden");
}

export function LabsSettingsSection() {
  const states = useSettingsStore((state) =>
    LABS.map((lab) => (labEnabled(lab.id, state) ? "1" : "0")).join(""),
  );
  useOrganizationStore((state) => state.policy);
  const [version, setVersion] = useState<string | null>(null);
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>("discover.labs");

  useEffect(() => {
    let alive = true;
    void getAppVersion().then((value) => {
      if (alive) setVersion(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div ref={ref} className="space-y-2" data-feature="discover.labs">
      <h3 className="flex items-center gap-2 pt-2 text-sm font-semibold">
        Labs
        {isNew && <NewBadge />}
      </h3>
      <div className="space-y-1 rounded-xl bg-muted/40 p-2">
        {LABS.map((lab, index) => (
          <SettingsRow key={lab.id} title={lab.title} description={lab.summary}>
            <div className="flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Feedback zu ${lab.title}`}
                title="Feedback"
                onClick={() => void feedback(lab, version)}
              >
                <MessageSquare />
              </Button>
              <Switch
                checked={states[index] === "1"}
                disabled={labLocked(lab.id)}
                onCheckedChange={(checked) => setLab(lab.id, checked)}
                aria-label={lab.title}
              />
            </div>
          </SettingsRow>
        ))}
      </div>
    </div>
  );
}
