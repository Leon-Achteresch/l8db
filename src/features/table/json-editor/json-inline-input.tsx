import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  initial: string;
  validate: (text: string) => string | null;
  onCommit: (text: string) => void;
  onCancel: () => void;
  className?: string;
};

export function JsonInlineInput({ initial, validate, onCommit, onCancel, className }: Props) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const error = validate(text);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    if (error) return;
    if (text === initial) onCancel();
    else onCommit(text);
  };

  return (
    <span className="relative flex min-w-0 flex-1 items-center">
      <input
        ref={ref}
        value={text}
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") commit();
          if (event.key === "Escape") onCancel();
        }}
        onBlur={() => (error ? onCancel() : commit())}
        className={cn(
          "h-5 min-w-24 flex-1 rounded-md border bg-background px-1.5 font-mono text-xs outline-none ring-2",
          error ? "border-destructive ring-destructive/25" : "border-primary/60 ring-primary/20",
          className,
        )}
      />
      {error && (
        <span className="absolute top-full left-0 z-10 mt-1 rounded-md bg-destructive px-1.5 py-0.5 text-[10px] text-white shadow">
          {error}
        </span>
      )}
    </span>
  );
}
