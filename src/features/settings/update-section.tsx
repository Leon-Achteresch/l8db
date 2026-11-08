import { Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "@/features/settings/settings-row";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useUpdatePrompt } from "@/lib/hooks/use-update-prompt";
import { type UpdateChannel, useSettingsStore } from "@/lib/settings";
import {
  checkAndPresentUpdate,
  getAppVersion,
  presentUpdate,
  switchUpdateChannel,
} from "@/lib/updater";

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available" }
  | { kind: "skipped" }
  | { kind: "failed"; message: string };

export function UpdateSection() {
  const { update: pending } = useUpdatePrompt();
  const [status, setStatus] = useState<Status>(() =>
    pending ? { kind: "available" } : { kind: "idle" },
  );
  const [version, setVersion] = useState<string | null>(null);
  const { autoUpdateCheck, autoUpdateInstall, setAutoUpdateCheck, setAutoUpdateInstall } =
    useSettingsStore();
  const skippedUpdateVersion = useSettingsStore((s) => s.skippedUpdateVersion);
  const setSkippedUpdateVersion = useSettingsStore((s) => s.setSkippedUpdateVersion);
  const updateChannel = useSettingsStore((s) => s.updateChannel);
  const autoFeatureVideos = useSettingsStore((s) => s.autoFeatureVideos);
  const setAutoFeatureVideos = useSettingsStore((s) => s.setAutoFeatureVideos);
  const blogSuggestions = useSettingsStore((s) => s.blogSuggestions);
  const setBlogSuggestions = useSettingsStore((s) => s.setBlogSuggestions);
  const isSkipped = Boolean(pending && skippedUpdateVersion === pending.version);

  useEffect(() => {
    if (!pending) return;
    setStatus(
      skippedUpdateVersion === pending.version ? { kind: "skipped" } : { kind: "available" },
    );
  }, [pending, skippedUpdateVersion]);

  useEffect(() => {
    let cancelled = false;
    void getAppVersion().then((v) => {
      if (!cancelled) setVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCheck(check: () => Promise<unknown> = checkAndPresentUpdate) {
    setStatus({ kind: "checking" });
    try {
      if (await check()) {
        setStatus({ kind: "available" });
      } else {
        setStatus({ kind: "current" });
      }
    } catch {
      setStatus({ kind: "failed", message: "Update-Prüfung fehlgeschlagen" });
    }
  }

  function onChannelChange(channel: UpdateChannel) {
    void onCheck(() => switchUpdateChannel(channel));
  }

  function onShowSkipped() {
    if (!pending) return;
    setSkippedUpdateVersion(null);
    setStatus({ kind: "available" });
    presentUpdate(pending);
  }

  return (
    <motion.div layout transition={{ layout: SPRING_LAYOUT }} className="space-y-3">
      <SettingsRow
        title="Installierte Version"
        description={version ? `l8db ${version}` : "Version wird ermittelt …"}
      >
        <Button
          variant="outline"
          onClick={() => void onCheck()}
          disabled={status.kind === "checking"}
        >
          <RefreshCw className={status.kind === "checking" ? "size-4 animate-spin" : "size-4"} />
          <span>{status.kind === "checking" ? "Prüfe …" : "Nach Updates suchen"}</span>
        </Button>
      </SettingsRow>
      <SettingsRow settingId="update-channel" featureId="settings.about.update-channel">
        <SegmentedControl
          value={updateChannel}
          onChange={onChannelChange}
          label="Update-Kanal"
          options={[
            { value: "stable", label: "Stable" },
            { value: "canary", label: "Canary" },
          ]}
        />
      </SettingsRow>
      <SettingsRow settingId="updates">
        <Switch
          checked={autoUpdateCheck}
          onCheckedChange={setAutoUpdateCheck}
          aria-label="Automatisch nach Updates suchen"
        />
      </SettingsRow>
      <SettingsRow settingId="auto-update-install">
        <Switch
          checked={autoUpdateInstall}
          disabled={!autoUpdateCheck}
          onCheckedChange={setAutoUpdateInstall}
          aria-label="Updates automatisch installieren"
        />
      </SettingsRow>
      <SettingsRow settingId="feature-videos">
        <Switch
          checked={autoFeatureVideos}
          onCheckedChange={setAutoFeatureVideos}
          aria-label="Neue Features automatisch zeigen"
        />
      </SettingsRow>
      <SettingsRow settingId="blog-suggestions" featureId="settings.about.blog-suggestions">
        <Switch
          checked={blogSuggestions}
          onCheckedChange={setBlogSuggestions}
          aria-label="Blog-Vorschläge zeigen"
        />
      </SettingsRow>
      <SettingsRow settingId="release-notes">
        <Button variant="outline" asChild>
          <Link to="/release-notes">Anzeigen</Link>
        </Button>
      </SettingsRow>
      {status.kind === "current" ? (
        <SettingsRow settingId="update-status">
          <span className="text-xs text-muted-foreground">Aktuell</span>
        </SettingsRow>
      ) : null}
      {status.kind === "failed" ? (
        <SettingsRow title="Updates" description={status.message}>
          <Button variant="outline" onClick={() => void onCheck()}>
            Erneut versuchen
          </Button>
        </SettingsRow>
      ) : null}
      {status.kind === "available" && pending && !isSkipped ? (
        <SettingsRow
          title="Update verfügbar"
          description={`Version ${pending.version} steht bereit.`}
        >
          <Button onClick={() => presentUpdate(pending)}>Anzeigen</Button>
        </SettingsRow>
      ) : null}
      {status.kind === "skipped" && pending ? (
        <SettingsRow
          title="Update übersprungen"
          description={`Version ${pending.version} wird nicht mehr vorgeschlagen.`}
        >
          <Button variant="outline" onClick={onShowSkipped}>
            Trotzdem anzeigen
          </Button>
        </SettingsRow>
      ) : null}
    </motion.div>
  );
}
