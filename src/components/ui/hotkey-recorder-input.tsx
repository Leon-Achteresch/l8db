import { useHotkeyRecorder } from "@tanstack/react-hotkeys";
import { KeyboardIcon, RotateCcwIcon } from "lucide-react";
import { useEffect } from "react";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { splitHotkeyForKbd } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";

interface HotkeyRecorderInputProps {
  value: string;
  isDefault: boolean;
  onRecord: (hotkey: string) => void;
  onClear: () => void;
  disabled?: boolean;
  ariaLabel: string;
}

export function HotkeyRecorderInput({
  value,
  isDefault,
  onRecord,
  onClear,
  disabled = false,
  ariaLabel,
}: HotkeyRecorderInputProps) {
  const recorder = useHotkeyRecorder({
    onRecord: (hotkey) => onRecord(hotkey),
    onClear,
  });

  useEffect(() => {
    if (disabled) recorder.cancelRecording();
  }, [disabled, recorder]);

  if (recorder.isRecording) {
    return (
      <button
        type="button"
        onClick={() => recorder.cancelRecording()}
        aria-label="Aufnahme abbrechen"
        className={cn(
          "inline-flex h-7 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary/15 px-2.5",
          "text-xs font-medium text-foreground",
          "animate-pulse cursor-pointer",
        )}
      >
        <KeyboardIcon className="size-3.5 shrink-0" />
        <span className="truncate">{recorder.recordedHotkey ?? "Tasten drücken…"}</span>
      </button>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <button
        type="button"
        disabled={disabled}
        onClick={() => recorder.startRecording()}
        aria-label={ariaLabel}
        title="Klicken und neue Tastenkombination drücken"
        className={cn(
          "inline-flex h-7 cursor-pointer items-center justify-center rounded-lg px-1.5",
          "transition-colors hover:bg-muted",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        <KbdGroup>
          {splitHotkeyForKbd(value).map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </KbdGroup>
      </button>
      {!isDefault && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`${ariaLabel} zurücksetzen`}
          title="Auf Standard zurücksetzen"
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RotateCcwIcon className="size-3.5" />
        </button>
      )}
    </span>
  );
}
