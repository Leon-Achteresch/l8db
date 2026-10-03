import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  LoaderCircle,
  MessageSquareText,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentDisclosure } from "@/features/ai/beui/agents/agent-disclosure";
import { EASE_OUT } from "@/features/ai/beui/lib/ease";
import { ActionSwapRollText } from "@/features/ai/beui/motion/action-swap-roll";
import { Button } from "@/features/ai/beui/motion/button";
import { cn } from "@/lib/utils";
import type { ApprovalCardAnswer, ApprovalCardAnswers, ApprovalCardProps } from "../types";
import { ProgressDots } from "./progress-dots";
import { QuestionOptions } from "./question-options";
import {
  EMPTY_ANSWER,
  getStatusBadgeClass,
  getStatusClass,
  getStatusLabel,
  isAnswered,
} from "./shared";

export function ApprovalCard({
  title = "Freigabe erforderlich",
  description,
  children,
  questions = [],
  status = "pending",
  answers,
  defaultAnswers = {},
  onAnswersChange,
  step,
  defaultStep = 0,
  onStepChange,
  onSubmit,
  onApprove,
  onReject,
  onRequestChanges,
  onDismiss,
  approveLabel = "Erlauben",
  approveDisabled = false,
  submitLabel = "Antwort senden",
  result,
  className,
}: ApprovalCardProps) {
  const reduce = useReducedMotion() ?? false;
  const [internalAnswers, setInternalAnswers] = useState<ApprovalCardAnswers>(defaultAnswers);
  const [internalStep, setInternalStep] = useState(defaultStep);
  const autoAdvanceTimer = useRef<number | undefined>(undefined);
  const currentAnswers = answers ?? internalAnswers;
  const currentStep = Math.min(
    Math.max(0, step ?? internalStep),
    Math.max(0, questions.length - 1),
  );
  const question = questions[currentStep];
  const questionMode = questions.length > 0;
  const multipleQuestions = questions.length > 1;
  const pending = status === "pending";
  const busy = status === "submitting";
  const interactive = pending || busy;
  const currentAnswer = question ? (currentAnswers[question.id] ?? EMPTY_ANSWER) : EMPTY_ANSWER;
  const displayTitle = question?.title ?? title;
  const titleKey = question?.id ?? String(status);
  const statusLabel = getStatusLabel(status);
  const clearAutoAdvance = useCallback(() => {
    if (autoAdvanceTimer.current === undefined) return;
    window.clearTimeout(autoAdvanceTimer.current);
    autoAdvanceTimer.current = undefined;
  }, []);
  useEffect(() => clearAutoAdvance, [clearAutoAdvance]);
  const setAnswers = useCallback(
    (next: ApprovalCardAnswers) => {
      if (answers === undefined) setInternalAnswers(next);
      onAnswersChange?.(next);
    },
    [answers, onAnswersChange],
  );
  const setStep = (next: number) => {
    clearAutoAdvance();
    if (step === undefined) setInternalStep(next);
    onStepChange?.(next);
  };
  const updateCurrentAnswer = (next: ApprovalCardAnswer) => {
    if (!question) return;
    setAnswers({ ...currentAnswers, [question.id]: next });
  };
  const continueQuestion = () => {
    if (currentStep < questions.length - 1) {
      setStep(currentStep + 1);
      return;
    }
    onSubmit?.(currentAnswers);
  };
  const queueAutoAdvance = () => {
    if (
      !question ||
      question.multiple ||
      question.autoAdvance === false ||
      currentStep >= questions.length - 1 ||
      busy
    ) {
      return;
    }
    clearAutoAdvance();
    autoAdvanceTimer.current = window.setTimeout(() => {
      setStep(currentStep + 1);
    }, 240);
  };
  return (
    <div
      data-state={status}
      aria-busy={busy}
      className={cn("w-full overflow-hidden rounded-2xl bg-muted p-4 text-sm", className)}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "grid size-5 shrink-0 place-items-center text-muted-foreground",
            getStatusClass(status),
          )}
        >
          {busy ? (
            <LoaderCircle className={cn("size-4", !reduce && "animate-spin")} />
          ) : interactive ? (
            questionMode ? (
              <CircleHelp className="size-4" />
            ) : (
              <MessageSquareText className="size-4" />
            )
          ) : status === "rejected" ? (
            <X className="size-4" />
          ) : (
            <Check className="size-4" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-3">
            <h3 className="min-w-0 flex-1 text-base font-medium leading-5 text-foreground">
              <ActionSwapRollText value={titleKey}>{displayTitle}</ActionSwapRollText>
            </h3>
            {questionMode && interactive ? (
              multipleQuestions ? (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground/65">
                  {currentStep + 1}/{questions.length}
                </span>
              ) : null
            ) : (
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                  getStatusBadgeClass(status),
                )}
              >
                {statusLabel}
              </span>
            )}
            {onDismiss ? (
              <button
                type="button"
                aria-label="Schließen"
                onClick={onDismiss}
                className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>

          <AgentDisclosure open={interactive}>
            {questionMode && question ? (
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={question.id}
                  initial={reduce ? { opacity: 1 } : { opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, x: -6 }}
                  transition={{ duration: reduce ? 0 : 0.2, ease: EASE_OUT }}
                >
                  {question.description ? (
                    <p className="mt-1 leading-5 text-muted-foreground">{question.description}</p>
                  ) : null}
                  <QuestionOptions
                    question={question}
                    answer={currentAnswer}
                    disabled={busy}
                    onChange={updateCurrentAnswer}
                    onSingleSelect={queueAutoAdvance}
                  />
                </motion.div>
              </AnimatePresence>
            ) : (
              <div>
                {description ? (
                  <p className="mt-1 leading-5 text-muted-foreground">{description}</p>
                ) : null}
                {children ? <div className="mt-3">{children}</div> : null}
              </div>
            )}

            {questionMode ? (
              <div className="mt-4 flex items-center gap-3">
                {multipleQuestions ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Vorherige Frage"
                      disabled={busy || currentStep === 0}
                      onClick={() => setStep(currentStep - 1)}
                      className="rounded-full"
                    >
                      <ArrowLeft className="size-4" />
                    </Button>
                    <ProgressDots current={currentStep} ids={questions.map((item) => item.id)} />
                  </>
                ) : null}
                <Button
                  size={currentStep === questions.length - 1 ? "sm" : "icon"}
                  aria-label={
                    currentStep === questions.length - 1 ? "Antwort senden" : "Nächste Frage"
                  }
                  disabled={busy || !isAnswered(currentAnswer)}
                  onClick={continueQuestion}
                  className="ml-auto rounded-full"
                >
                  {busy ? (
                    <LoaderCircle className={cn("size-4", !reduce && "animate-spin")} />
                  ) : currentStep === questions.length - 1 ? (
                    <>
                      {submitLabel}
                      <ArrowRight className="size-3.5" />
                    </>
                  ) : (
                    <ArrowRight className="size-4" />
                  )}
                </Button>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={busy || approveDisabled}
                  onClick={onApprove}
                  className="rounded-full"
                >
                  {approveLabel}
                </Button>
                {onRequestChanges ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={onRequestChanges}
                    className="rounded-full"
                  >
                    Request changes
                  </Button>
                ) : null}
                {onReject ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={onReject}
                    className="rounded-full text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"
                  >
                    Ablehnen
                  </Button>
                ) : null}
              </div>
            )}
          </AgentDisclosure>

          {!interactive ? (
            <p className="mt-1 text-sm text-muted-foreground">{result ?? statusLabel}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
