import { useCallback, useEffect, useMemo, useState } from "react";
import { BlogSuggestionCard } from "@/features/updates/blog-suggestion-card";
import { COOLDOWN, nextSuggestion } from "@/lib/blog-suggestions/model";
import { watchQuiet } from "@/lib/blog-suggestions/quiet";
import {
  readBlogPost,
  refreshBlogFeed,
  useBlogSuggestionStore,
} from "@/lib/blog-suggestions/store";
import { useFeatureVideoStore } from "@/lib/feature-videos/store";
import { useSettingsStore } from "@/lib/settings";
import { getAppVersion } from "@/lib/updater";

export function BlogSuggestionHost() {
  const enabled = useSettingsStore((s) => s.blogSuggestions);
  const videoActive = useFeatureVideoStore((s) => s.activeId !== null);
  const posts = useBlogSuggestionStore((s) => s.posts);
  const history = useBlogSuggestionStore((s) => s.history);
  const lastShownAt = useBlogSuggestionStore((s) => s.lastShownAt);
  const activeSlug = useBlogSuggestionStore((s) => s.activeSlug);
  const show = useBlogSuggestionStore((s) => s.show);
  const finish = useBlogSuggestionStore((s) => s.finish);
  const [version, setVersion] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let alive = true;
    void getAppVersion().then((value) => {
      if (alive && typeof value === "string") setVersion(value);
    });
    const update = () => {
      setFocused(!document.hidden && document.hasFocus());
      setOnline(navigator.onLine);
      setNow(Date.now());
    };
    update();
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      alive = false;
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  const cooling = now - lastShownAt < COOLDOWN;
  useEffect(() => {
    if (!enabled || !online || !focused || cooling) return;
    const controller = new AbortController();
    void refreshBlogFeed(controller.signal);
    return () => controller.abort();
  }, [enabled, online, focused, cooling]);

  const pending = useMemo(
    () => enabled && now > 0 && nextSuggestion(posts, history, lastShownAt, version, now) !== null,
    [enabled, posts, history, lastShownAt, version, now],
  );
  useEffect(() => {
    if (!pending || activeSlug || !focused || videoActive) return;
    return watchQuiet(() => {
      const state = useBlogSuggestionStore.getState();
      const next = nextSuggestion(state.posts, state.history, state.lastShownAt, version);
      if (next) show(next.slug);
    });
  }, [pending, activeSlug, focused, videoActive, version, show]);

  const post = useMemo(
    () => (activeSlug ? posts.find((item) => item.slug === activeSlug) : undefined),
    [activeSlug, posts],
  );
  useEffect(() => {
    if (activeSlug && (!post || !enabled || videoActive)) finish(activeSlug, "seen");
  }, [activeSlug, post, enabled, videoActive, finish]);

  const dismiss = useCallback(() => {
    if (activeSlug) finish(activeSlug, "dismissed");
  }, [activeSlug, finish]);
  const expire = useCallback(() => {
    if (activeSlug) finish(activeSlug, "seen");
  }, [activeSlug, finish]);
  const read = useCallback(() => {
    if (post) void readBlogPost(post);
  }, [post]);

  const visible = post && enabled && !videoActive ? post : null;
  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {visible && focused ? `Blog-Vorschlag: ${visible.title}` : ""}
      </div>
      {visible ? (
        <BlogSuggestionCard
          key={visible.slug}
          post={visible}
          suspended={!focused}
          onDismiss={dismiss}
          onRead={read}
          onExpire={expire}
        />
      ) : null}
    </>
  );
}
