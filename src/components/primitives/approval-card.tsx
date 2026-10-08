import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GlideMenu } from "./glide-menu";

export interface ApprovalQuestion {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  options?: { value: string; label: ReactNode; hint?: ReactNode }[];
  multiple?: boolean;
}

export type ApprovalAnswers = Record<string, { selected: string[]; custom: string }>;

const SLIDE = "360ms cubic-bezier(0.22, 1, 0.36, 1)";

export function ApprovalCard({
  questions,
  pending = false,
  submitLabel = "Antwort senden",
  customPlaceholder = "Eigene Antwort …",
  onSubmit,
  className,
}: {
  questions: ApprovalQuestion[];
  pending?: boolean;
  submitLabel?: string;
  customPlaceholder?: string;
  onSubmit: (answers: ApprovalAnswers) => void;
  className?: string;
}) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<"up" | "down">("down");
  const [answers, setAnswers] = useState<ApprovalAnswers>({});
  const [frame, setFrame] = useState<{ height?: number; offset: number; animate: boolean }>({
    offset: 0,
    animate: false,
  });
  const items = useRef<(HTMLDivElement | null)[]>([]);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const measured = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const last = step === questions.length - 1;
  const freeText = !questions[step]?.options?.length;
  const current = answers[questions[step]?.id];
  const answered = Boolean(current?.selected.length || current?.custom.trim());

  useLayoutEffect(() => {
    const item = items.current[step];
    if (!item) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setFrame({
      height: item.offsetHeight,
      offset: item.offsetTop,
      animate: measured.current && !reduce,
    });
    if (measured.current && freeText) inputs.current[step]?.focus({ preventScroll: true });
    measured.current = true;
  }, [step, freeText]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const goTo = (next: number) => {
    clearTimeout(timer.current);
    const target = Math.min(Math.max(next, 0), questions.length - 1);
    setDirection(target < step ? "up" : "down");
    setStep(target);
  };
  const submit = () => {
    clearTimeout(timer.current);
    onSubmit(answers);
  };
  const advance = () => (last ? submit() : goTo(step + 1));
  const update = (id: string, change: Partial<ApprovalAnswers[string]>) =>
    setAnswers((all) => ({
      ...all,
      [id]: { ...{ selected: [], custom: "" }, ...all[id], ...change },
    }));
  const toggle = (question: ApprovalQuestion, value: string) => {
    const picked = answers[question.id]?.selected ?? [];
    if (question.multiple) {
      update(question.id, {
        selected: picked.includes(value)
          ? picked.filter((entry) => entry !== value)
          : [...picked, value],
      });
      return;
    }
    update(question.id, { selected: [value], custom: "" });
    clearTimeout(timer.current);
    if (!last) timer.current = setTimeout(() => goTo(step + 1), 420);
  };

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs animate-in fade-in slide-in-from-bottom-1 duration-300",
        className,
      )}
    >
      <div className="px-2.5 pt-3.5 pb-3">
        <div
          className="overflow-hidden px-1"
          style={{
            height: frame.height,
            transition: frame.animate ? `height ${SLIDE}` : undefined,
          }}
          aria-live="polite"
        >
          <div
            className="flex flex-col gap-[26px] will-change-transform"
            style={{
              transform: `translate3d(0, ${-frame.offset}px, 0)`,
              transition: frame.animate ? `transform ${SLIDE}` : undefined,
            }}
          >
            {questions.map((question, index) => {
              const active = index === step;
              const picked = answers[question.id]?.selected ?? [];
              return (
                <div
                  key={question.id}
                  ref={(element) => {
                    items.current[index] = element;
                  }}
                  inert={!active}
                  className="transition-opacity"
                  style={{
                    opacity: active ? 1 : 0,
                    transition: frame.animate ? `opacity ${SLIDE}` : undefined,
                  }}
                >
                  <p className="text-[13px] font-medium leading-snug">{question.title}</p>
                  {question.description && (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {question.description}
                    </p>
                  )}
                  <GlideMenu className="-mx-1 mt-2 flex flex-col gap-px">
                    {question.options?.map((option) => {
                      const on = picked.includes(option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          data-menu-row
                          aria-pressed={on}
                          disabled={pending}
                          onClick={() => toggle(question, option.value)}
                          className="relative flex min-h-8 items-start gap-2 rounded-md px-1.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span
                            className={cn(
                              "mt-px flex size-4 shrink-0 items-center justify-center transition-colors duration-200",
                              question.multiple ? "rounded-[5px]" : "rounded-full",
                              on
                                ? "bg-primary text-primary-foreground"
                                : "text-transparent shadow-[inset_0_0_0_1.5px_var(--border)]",
                            )}
                          >
                            {question.multiple ? (
                              <Check className="size-3" strokeWidth={3} />
                            ) : (
                              <span
                                className={cn(
                                  "size-1.5 rounded-full bg-primary-foreground transition-transform duration-200",
                                  on ? "scale-100" : "scale-0",
                                )}
                              />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                "block text-[13px] leading-4 transition-colors",
                                on ? "text-foreground" : "text-foreground/80",
                              )}
                            >
                              {option.label}
                            </span>
                            {option.hint && (
                              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                {option.hint}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                    <label
                      data-menu-row
                      className="relative flex min-h-8 items-center rounded-md px-1.5"
                    >
                      <input
                        ref={(element) => {
                          inputs.current[index] = element;
                        }}
                        value={answers[question.id]?.custom ?? ""}
                        disabled={pending}
                        onChange={(event) =>
                          update(question.id, {
                            custom: event.target.value,
                            ...(question.multiple ? {} : { selected: [] }),
                          })
                        }
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" || !answered) return;
                          event.preventDefault();
                          advance();
                        }}
                        placeholder={customPlaceholder}
                        aria-label={
                          !question.options?.length && typeof question.title === "string"
                            ? question.title
                            : "Eigene Antwort"
                        }
                        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
                      />
                    </label>
                  </GlideMenu>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-2.5 py-2">
        {questions.length > 1 ? (
          <div className="flex items-center gap-0.5 text-muted-foreground">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Vorherige Frage"
              disabled={step === 0}
              onClick={() => goTo(step - 1)}
            >
              <ChevronUp />
            </Button>
            <span className="inline-flex h-4 overflow-hidden text-[11px] font-medium tabular-nums">
              <span
                key={step}
                className={cn(
                  "animate-in fade-in duration-300",
                  direction === "down" ? "slide-in-from-bottom-2" : "slide-in-from-top-2",
                )}
              >
                {step + 1} / {questions.length}
              </span>
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Nächste Frage"
              disabled={last}
              onClick={() => goTo(step + 1)}
            >
              <ChevronDown />
            </Button>
          </div>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1.5">
          {!last && (
            <Button size="xs" variant="ghost" disabled={pending} onClick={() => goTo(step + 1)}>
              Überspringen
            </Button>
          )}
          <Button size="xs" disabled={pending || (!last && !answered)} onClick={advance}>
            {last ? submitLabel : "Weiter"}
          </Button>
        </div>
      </div>
    </div>
  );
}
