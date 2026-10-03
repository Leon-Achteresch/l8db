import { Checkbox } from "@/features/ai/beui/motion/checkbox";
import { RadioGroup, RadioGroupItem } from "@/features/ai/beui/motion/radio";
import { cn } from "@/lib/utils";
import type { ApprovalCardAnswer, ApprovalCardQuestion } from "../types";

export function QuestionOptions({
  question,
  answer,
  disabled,
  onChange,
  onSingleSelect,
}: {
  question: ApprovalCardQuestion;
  answer: ApprovalCardAnswer;
  disabled: boolean;
  onChange: (answer: ApprovalCardAnswer) => void;
  onSingleSelect?: () => void;
}) {
  const custom = answer.custom ?? "";
  return (
    <div className="mt-3">
      {question.options?.length ? (
        question.multiple ? (
          <div className="grid gap-0.5">
            {question.options.map((option) => (
              <Checkbox
                key={option.value}
                checked={answer.selected.includes(option.value)}
                disabled={disabled || option.disabled}
                label={option.label}
                onCheckedChange={(checked) =>
                  onChange({
                    ...answer,
                    selected: checked
                      ? [...answer.selected, option.value]
                      : answer.selected.filter((value) => value !== option.value),
                  })
                }
                className="min-h-9 rounded-lg px-1.5 py-1"
              />
            ))}
          </div>
        ) : (
          <RadioGroup
            value={answer.selected[0] ?? ""}
            onValueChange={(value) => {
              onChange({ selected: [value], custom: "" });
              onSingleSelect?.();
            }}
            className="gap-0.5"
          >
            {question.options.map((option) => (
              <RadioGroupItem
                key={option.value}
                value={option.value}
                label={option.label}
                disabled={disabled || option.disabled}
                className="min-h-9 rounded-lg px-1.5 py-1"
              />
            ))}
          </RadioGroup>
        )
      ) : null}

      {question.allowCustom ? (
        <textarea
          aria-label={String(question.title)}
          value={custom}
          disabled={disabled}
          placeholder={question.customPlaceholder ?? "Eigene Antwort …"}
          onChange={(event) =>
            onChange({
              selected: question.multiple ? answer.selected : [],
              custom: event.target.value,
            })
          }
          className={cn(
            "min-h-20 w-full rounded-lg border bg-background p-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
            question.options?.length && "mt-2",
          )}
        />
      ) : null}
    </div>
  );
}
