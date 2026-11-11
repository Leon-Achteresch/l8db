import { ArrowUp, MousePointer2, Sparkles, Square } from "lucide-react";
import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import { isAbort } from "@/lib/ai/editor/client";
import { featureById } from "@/lib/discovery/catalog";
import {
  askTour,
  TOUR_HISTORY_TURNS,
  TOUR_MASCOT_NAME,
  TOUR_QUESTION_MAX,
  type TourAnswer,
  type TourLastAnswer,
  type TourTurn,
} from "@/lib/tour/ask";
import { useTourStore } from "@/lib/tour/store";

interface Props {
  stepId: string;
  stepTitle: string | null;
  history: RefObject<TourTurn[]>;
  lastAnswer: RefObject<TourLastAnswer | null>;
  onThinking: (thinking: boolean) => void;
}

export function TourAsk({ stepId, stepTitle, history, lastAnswer, onThinking }: Props) {
  const restored = lastAnswer.current?.stepId === stepId ? lastAnswer.current : null;
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(restored?.question ?? null);
  const [answer, setAnswer] = useState<TourAnswer | null>(restored?.answer ?? null);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
      onThinking(false);
    },
    [onThinking],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    const current = new AbortController();
    controller.current = current;
    setAsked(text);
    setAnswer(null);
    setPartial("");
    setError(null);
    setQuestion("");
    setBusy(true);
    onThinking(true);
    try {
      const result = await askTour(text, stepTitle ? { title: stepTitle } : null, history.current, {
        signal: current.signal,
        onDelta: setPartial,
      });
      setAnswer(result);
      lastAnswer.current = { stepId, question: text, answer: result };
      history.current = [...history.current, { question: text, answer: result.text }].slice(
        -TOUR_HISTORY_TURNS,
      );
    } catch (caught) {
      if (!isAbort(caught)) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setBusy(false);
        onThinking(false);
      }
    }
  }

  const shown = answer?.text ?? partial;

  return (
    <div data-tour-ui="ask" className="px-4 pt-3">
      {asked ? (
        <div
          data-tour-ui="answer"
          aria-live="polite"
          className="mb-2 rounded-xl bg-muted/50 px-3 py-2.5"
        >
          <p className="truncate text-[11px] font-medium text-muted-foreground">{asked}</p>
          {shown ? (
            <p className="mt-1 text-[13px] leading-5 whitespace-pre-wrap text-foreground">
              {shown}
            </p>
          ) : busy ? (
            <p
              className="mt-2 flex gap-1"
              role="status"
              aria-label={`${TOUR_MASCOT_NAME} denkt nach`}
            >
              <span className="size-1.5 animate-pulse rounded-full bg-primary" />
              <span className="size-1.5 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
              <span className="size-1.5 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
            </p>
          ) : null}
          {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
          {answer?.featureIds.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {answer.featureIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => useTourStore.getState().showFeature(id)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full bg-primary/12 px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-primary/20 active:scale-[0.98]"
                >
                  <MousePointer2 className="size-3 text-primary" />
                  Zeig mir: {featureById(id)?.title ?? id}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <form
        onSubmit={submit}
        className="flex items-center gap-1.5 rounded-full bg-muted/60 py-1 pr-1 pl-3 transition-shadow focus-within:ring-2 focus-within:ring-ring/40"
      >
        <Sparkles className="size-3.5 shrink-0 text-primary" />
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={TOUR_QUESTION_MAX}
          placeholder={`Frag ${TOUR_MASCOT_NAME} …`}
          aria-label={`Frage an ${TOUR_MASCOT_NAME}`}
          className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        />
        {busy ? (
          <button
            type="button"
            aria-label="Antwort abbrechen"
            onClick={() => controller.current?.abort()}
            className="grid size-7 shrink-0 place-items-center rounded-full bg-foreground/10 text-foreground transition-colors hover:bg-foreground/15"
          >
            <Square className="size-3" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="Frage senden"
            disabled={!question.trim()}
            className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-35"
          >
            <ArrowUp className="size-3.5" />
          </button>
        )}
      </form>
    </div>
  );
}
