import { Bug, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SettingsRow } from "@/features/settings/settings-row";
import { featureById } from "@/lib/discovery/catalog";
import {
  type FeedbackAnswer,
  feedbackIssueText,
  useFeedbackStore,
} from "@/lib/discovery/feedback/store";

const dateFormat = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" });

async function reportAsIssue(answer: FeedbackAnswer) {
  try {
    const { useAiStore } = await import("@/lib/ai/store");
    useAiStore.getState().draft(feedbackIssueText(answer));
  } catch (error) {
    toast.error("KI-Chat konnte nicht geöffnet werden", { description: String(error) });
  }
}

export default function FeedbackSettings() {
  const answers = useFeedbackStore((state) => state.answers);
  const remove = useFeedbackStore((state) => state.remove);

  return (
    <SettingsRow title="Dein Feedback" featureId="discover.feedback" stacked>
      {answers.length === 0 ? (
        <p className="text-xs text-muted-foreground">Noch keins</p>
      ) : (
        <ul className="space-y-1 rounded-xl bg-muted/40 p-1.5">
          {[...answers].reverse().map((answer) => {
            const Icon = answer.vote === "up" ? ThumbsUp : ThumbsDown;
            return (
              <li
                key={answer.at}
                className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/60"
              >
                <Icon
                  className={
                    answer.vote === "up"
                      ? "size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                      : "size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                  }
                />
                <span className="shrink-0 font-medium">
                  {featureById(answer.featureId)?.title ?? answer.featureId}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {answer.text}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {dateFormat.format(answer.at)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => void reportAsIssue(answer)}
                >
                  <Bug className="size-3.5" />
                  Als Issue melden
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Feedback löschen"
                  className="text-muted-foreground"
                  onClick={() => remove(answer.at)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsRow>
  );
}
