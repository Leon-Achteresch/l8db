import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  type FeedbackVote,
  MAX_FEEDBACK_TEXT,
  useFeedbackStore,
} from "@/lib/discovery/feedback/store";
import { cn } from "@/lib/utils";
import { DiscoveryCard } from "../promoter/discovery-card";

interface Props {
  featureId: string;
  title: string;
  onDone: () => void;
}

export function FeedbackCard({ featureId, title, onDone }: Props) {
  const [vote, setVote] = useState<FeedbackVote | null>(null);
  const [text, setText] = useState("");

  const finish = () => {
    const store = useFeedbackStore.getState();
    if (vote) store.answer(featureId, vote, text);
    else store.dismiss();
    onDone();
  };

  const voteButton = (value: FeedbackVote) => {
    const Icon = value === "up" ? ThumbsUp : ThumbsDown;
    return (
      <Button
        size="sm"
        variant="ghost"
        aria-pressed={vote === value}
        aria-label={value === "up" ? "Gefällt mir" : "Gefällt mir nicht"}
        className={cn("h-8 gap-1.5 px-3", vote === value && "bg-primary/12 text-primary")}
        onClick={() => setVote(value)}
      >
        <Icon className="size-4" />
      </Button>
    );
  };

  return (
    <DiscoveryCard
      label="Kurzes Feedback"
      title={`Wie gefällt dir „${title}“?`}
      featureId="discover.feedback"
      autoCloseMs={vote ? undefined : 20_000}
      onClose={finish}
    >
      <div className="flex items-center gap-1">
        {voteButton("up")}
        {voteButton("down")}
        {vote ? (
          <Button size="sm" className="ml-auto h-7 px-2.5 text-xs" onClick={finish}>
            Fertig
          </Button>
        ) : null}
      </div>
      {vote ? (
        <Textarea
          value={text}
          maxLength={MAX_FEEDBACK_TEXT}
          onChange={(event) => setText(event.target.value)}
          placeholder="Optional: Was fehlt?"
          aria-label="Feedback-Text"
          className="mt-2 min-h-16 resize-none bg-muted/40 text-xs"
        />
      ) : null}
    </DiscoveryCard>
  );
}
