import { Check, Loader2, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { forwardRef } from "react";
import { Button } from "../base";
import { IconSlot } from "./icon-slot";
import type { StatefulButtonProps } from "./shared";
import { TextSlot } from "./text-slot";
export const StatefulButton = forwardRef<HTMLButtonElement, StatefulButtonProps>(
  function StatefulButton(
    {
      state = "idle",
      children,
      loadingText = "Loading",
      successText = "Done",
      errorText = "Try again",
      icon,
      disabled,
      ...rest
    },
    ref,
  ) {
    const isBusy = state === "loading";
    const stateText =
      state === "loading"
        ? loadingText
        : state === "success"
          ? successText
          : state === "error"
            ? errorText
            : children;
    const textKey = typeof stateText === "string" ? `${state}-${stateText}` : state;
    return (
      <Button
        ref={ref}
        disabled={disabled || isBusy}
        aria-busy={isBusy}
        whileHover={undefined}
        {...rest}
      >
        <span
          aria-live="polite"
          className="relative inline-flex items-center justify-center overflow-hidden"
        >
          <AnimatePresence initial={false}>
            {state === "loading" ? (
              <IconSlot keyId="loading-icon">
                <Loader2 className="h-4 w-4 animate-spin" />
              </IconSlot>
            ) : null}
            {state === "success" ? (
              <IconSlot keyId="success-icon">
                <Check className="h-4 w-4" />
              </IconSlot>
            ) : null}
            {state === "error" ? (
              <IconSlot keyId="error-icon">
                <X className="h-4 w-4" />
              </IconSlot>
            ) : null}
          </AnimatePresence>

          <TextSlot value={textKey}>{stateText}</TextSlot>

          <AnimatePresence initial={false}>
            {state === "idle" && icon ? <IconSlot keyId="idle-icon">{icon}</IconSlot> : null}
          </AnimatePresence>
        </span>
      </Button>
    );
  },
);
