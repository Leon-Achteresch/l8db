import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { isThemeColor, type ThemeColorToken } from "@/lib/app-themes";
import { cn } from "@/lib/utils";

type Props = {
  token: ThemeColorToken;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
};

const HEX = /^#[0-9a-f]{6}$/i;

export function ThemeColorField({ token, value, onChange }: Props) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const invalid = text.trim() !== "" && !isThemeColor(text);
  const commit = (next: string) => {
    setText(next);
    if (!next.trim()) onChange(undefined);
    else if (isThemeColor(next)) onChange(next.trim());
  };
  return (
    <div className="flex items-center gap-2" data-theme-token={token}>
      <label
        className={cn(
          "relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-md shadow-sm ring-1 ring-black/10 transition-transform hover:scale-105 dark:ring-white/15",
          !value &&
            "bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:8px_8px]",
        )}
        style={value ? { background: value } : undefined}
      >
        <input
          type="color"
          aria-label={token}
          value={value && HEX.test(value) ? value : "#808080"}
          onChange={(event) => commit(event.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <span className="w-40 shrink-0 truncate font-mono text-xs text-muted-foreground">
        {token}
      </span>
      <Input
        value={text}
        placeholder="auto"
        aria-invalid={invalid}
        onChange={(event) => commit(event.target.value)}
        className="h-7 min-w-0 flex-1 font-mono text-xs"
      />
      <button
        type="button"
        aria-label={`${token} zurücksetzen`}
        disabled={!value}
        onClick={() => commit("")}
        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-0"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
