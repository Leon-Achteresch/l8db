import { useEffect, useMemo, useState } from "react";
import { useActiveCapabilities } from "@/lib/db-selection";
import { useSettingsStore } from "@/lib/settings";
import { getAppVersion } from "@/lib/updater";
import { eligibleVideos } from "./model";
import { refreshFeatureVideos, useFeatureVideoStore } from "./store";

export function useFeatureVideos() {
  const feed = useFeatureVideoStore((s) => s.feed);
  const capabilities = useActiveCapabilities();
  const easyMode = useSettingsStore((s) => s.easyMode);
  const [version, setVersion] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let alive = true;
    void getAppVersion().then((value) => {
      if (alive && typeof value === "string") setVersion(value);
    });
    const refresh = () => {
      setNow(Date.now());
      if (!document.hidden) void refreshFeatureVideos();
    };
    refresh();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const platform = /Mac/.test(navigator.platform)
    ? "macos"
    : /Win/.test(navigator.platform)
      ? "windows"
      : "linux";
  const items = useMemo(
    () =>
      eligibleVideos(feed, { version, capabilities: { ...capabilities }, easyMode, platform, now }),
    [feed, version, capabilities, easyMode, platform, now],
  );
  return { items, version };
}
