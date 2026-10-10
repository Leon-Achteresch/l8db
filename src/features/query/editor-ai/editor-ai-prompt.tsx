import { ArrowUp, Check, LoaderCircle, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import type { EditSnapshot, InlineEditSession } from "@/lib/ai/editor/inline-edit";
import { EDITOR_AI_ACTION_LABELS } from "@/lib/ai/editor/metrics";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { formatHotkeyDisplay } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";

interface Props {
  session: InlineEditSession;
  snapshot: EditSnapshot;
}

function tokens(usage: EditSnapshot["usage"]): string {
  if (!usage) return "";
  const share = usage.input ? Math.round((usage.cached / usage.input) * 100) : 0;
  return `${usage.input.toLocaleString("de-DE")} → ${usage.output.toLocaleString("de-DE")} Tokens${share ? ` · ${share}% Cache` : ""}`;
}

export function EditorAiPrompt({ session, snapshot }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(snapshot.phase === "input" ? snapshot.instruction : "");
  const { phase } = snapshot;
  const running = phase === "running";
  const review = phase === "review";
  const chat = snapshot.action === "chat";
  const feature = useNewFeatureVisibility<HTMLSpanElement>(
    chat ? "ai.chat.editor-edits" : undefined,
  );

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    session.setPromptHeight(element.offsetHeight + 8);
    const observer = new ResizeObserver(() => session.setPromptHeight(element.offsetHeight + 8));
    observer.observe(element);
    return () => observer.disconnect();
  }, [session]);

  useEffect(() => {
    if (running || chat) return;
    const element = input.current;
    if (!element) return;
    const focus = () => {
      element.focus({ preventScroll: true });
      element.setSelectionRange(element.value.length, element.value.length);
    };
    focus();
    const frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [running, chat]);

  useEffect(() => {
    if (review) setValue("");
  }, [review]);

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`;
  });

  const submit = () => {
    if (running) return;
    void session.submit(value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    const mod = event.metaKey || event.ctrlKey;
    if (review && mod && event.key === "Enter") {
      event.preventDefault();
      session.acceptAll();
    } else if (review && mod && event.key === "Backspace") {
      event.preventDefault();
      session.rejectAll();
    } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (review && !value.trim()) session.acceptAll();
      else submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      session.cancel();
    }
  };

  const label = snapshot.action === "edit" || chat ? "" : EDITOR_AI_ACTION_LABELS[snapshot.action];
  const usage = tokens(snapshot.usage);
  const footer = Boolean(
    label ||
      phase !== "input" ||
      snapshot.error ||
      snapshot.warning ||
      snapshot.model ||
      usage ||
      snapshot.earlier.length,
  );

  return (
    <div className="px-2 pt-1 pb-1">
      <div
        ref={root}
        className={cn(
          "max-w-3xl rounded-xl border bg-popover/95 text-popover-foreground shadow-[0_8px_24px_-14px_oklch(0_0_0/45%)] backdrop-blur-sm",
          snapshot.error ? "border-destructive/40" : "border-border",
        )}
      >
        <div className="flex items-start gap-2 px-2.5 pt-2 pb-1.5">
          <Sparkles className="mt-1.5 size-3.5 shrink-0 text-primary" aria-hidden />
          {chat ? (
            <span
              ref={feature.ref}
              className="flex min-h-6 flex-1 items-center gap-1.5 truncate py-1 text-[13px] leading-5"
            >
              {snapshot.instruction}
              {feature.isNew && <NewBadge />}
            </span>
          ) : (
            <textarea
              ref={input}
              rows={1}
              value={value}
              disabled={running}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                review
                  ? "Weiter anpassen … (Enter ohne Text übernimmt alles)"
                  : snapshot.placeholder
              }
              aria-label="Anweisung an die KI"
              className="min-h-6 flex-1 resize-none bg-transparent py-1 text-[13px] leading-5 outline-none! placeholder:text-muted-foreground/70 disabled:opacity-60"
            />
          )}
          {chat ? null : running ? (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Abbrechen"
              title="Abbrechen (Esc)"
              onClick={() => session.cancel()}
            >
              <Square className="fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon-xs"
              aria-label="Senden"
              title="Senden (Enter)"
              disabled={
                !value.trim() && !review && !snapshot.instruction && snapshot.action === "edit"
              }
              onClick={submit}
            >
              <ArrowUp />
            </Button>
          )}
          {!(chat && running) && (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Schließen"
              title="Schließen"
              onClick={() => (review ? session.rejectAll() : session.close())}
            >
              <X />
            </Button>
          )}
        </div>
        {footer && (
          <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground">
            {label && (
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                {label}
              </span>
            )}
            {running && (
              <span className="inline-flex items-center gap-1">
                <LoaderCircle className="size-3 animate-spin" aria-hidden />
                {snapshot.status}
                {snapshot.streamed > 0 && (
                  <span className="tabular-nums">
                    {snapshot.streamed.toLocaleString("de-DE")} Zeichen
                  </span>
                )}
              </span>
            )}
            {review && (
              <>
                <Button
                  type="button"
                  size="xs"
                  className="h-5 bg-emerald-600/90 text-white hover:bg-emerald-600"
                  onClick={() => session.acceptAll()}
                >
                  <Check />
                  Alle annehmen
                  <span className="opacity-70">{formatHotkeyDisplay("Mod+Enter")}</span>
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="h-5"
                  onClick={() => session.rejectAll()}
                >
                  <X />
                  Alle ablehnen
                  <span className="opacity-70">{formatHotkeyDisplay("Mod+Backspace")}</span>
                </Button>
                <span className="tabular-nums">
                  {snapshot.pending} {snapshot.pending === 1 ? "Änderung" : "Änderungen"} offen
                </span>
              </>
            )}
            {phase === "error" && (
              <>
                <span className="text-destructive">{snapshot.error}</span>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="h-5"
                  onClick={() => void session.submit(snapshot.instruction)}
                >
                  <RotateCcw />
                  Erneut versuchen
                </Button>
              </>
            )}
            {phase === "input" && snapshot.error && (
              <span className="text-destructive">{snapshot.error}</span>
            )}
            {snapshot.warning && (
              <span className="text-amber-700 dark:text-amber-300">{snapshot.warning}</span>
            )}
            <span className="ml-auto flex items-center gap-2">
              {snapshot.earlier.length > 0 && <span>Runde {snapshot.earlier.length + 1}</span>}
              {snapshot.model && <span className="font-mono text-[10px]">{snapshot.model}</span>}
              {usage && <span className="tabular-nums">{usage}</span>}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
