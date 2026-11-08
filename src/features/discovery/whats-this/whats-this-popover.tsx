import { useNavigate, useRouterState } from "@tanstack/react-router";
import { BookOpen, Bug, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useAiStore } from "@/lib/ai/store";
import { highlightFeature } from "@/lib/discovery/highlight";
import { resolveClip } from "@/lib/discovery/video-tooltips/media";
import {
  describeElementForIssue,
  issueDraftFor,
  type WhatsThisMatch,
} from "@/lib/discovery/whats-this/whats-this";
import { useFeatureVideoStore } from "@/lib/feature-videos/store";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { commandById } from "@/lib/hotkeys/commands";
import { splitHotkeyForKbd } from "@/lib/hotkeys/display";
import { useResolvedHotkey } from "@/lib/hotkeys/use-hotkeys-store";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function WhatsThisPopover({
  element,
  match,
  onClose,
}: {
  element: Element;
  match: WhatsThisMatch;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const feature = useNewFeatureVisibility<HTMLDivElement>("discover.whats-this");
  const hotkey = useResolvedHotkey(match.hotkey ?? "");
  const command = match.hotkey ? commandById(match.hotkey) : undefined;
  const entry = match.entry;
  const hasVideo = useFeatureVideoStore(
    (state) => resolveClip(entry?.videoId, state.feed, true) !== null,
  );

  const report = async () => {
    const description = describeElementForIssue(element, pathname, match);
    onClose();
    try {
      await nextFrame();
      await nextFrame();
      const [{ captureRedactedScreenshot }, { setPendingIssueScreenshot }] = await Promise.all([
        import("@/lib/issue-screenshot"),
        import("@/lib/ai/issue"),
      ]);
      setPendingIssueScreenshot(
        element.isConnected ? await captureRedactedScreenshot(element).catch(() => null) : null,
      );
    } catch (error) {
      toast.error("Screenshot fehlgeschlagen", { description: String(error) });
    }
    useAiStore.getState().draft(issueDraftFor(description));
  };

  const showMe = () => {
    if (!entry) return;
    onClose();
    void import("@/lib/discovery/guide/engine")
      .then(({ startGuide }) => startGuide(entry.id))
      .catch(() => false)
      .then((started) => {
        if (!started) void highlightFeature(entry.id);
      });
  };

  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor virtualRef={{ current: element }} />
      <PopoverContent side="bottom" align="start" className="w-80 gap-3" aria-label="Was ist das?">
        <div ref={feature.ref} className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate font-medium">
              {entry?.title ?? command?.label ?? "Nicht im Katalog"}
            </span>
            {feature.isNew && <NewBadge />}
            {entry && (
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                {entry.area}
              </span>
            )}
          </div>
          {entry && <p className="text-xs text-muted-foreground">{entry.summary}</p>}
          {command && (
            <KbdGroup className="mt-1">
              {splitHotkeyForKbd(hotkey).map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </KbdGroup>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {entry?.videoId && hasVideo && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onClose();
                useFeatureVideoStore.getState().open(entry.videoId as string, true);
              }}
            >
              <Play />
              Video
            </Button>
          )}
          {entry?.steps?.length ? (
            <Button size="sm" variant="secondary" onClick={showMe}>
              <Sparkles />
              Zeig's mir
            </Button>
          ) : null}
          {entry && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onClose();
                void navigate({ to: "/docs" });
              }}
            >
              <BookOpen />
              Doku
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void report()}>
            <Bug />
            Hier ein Problem melden
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
