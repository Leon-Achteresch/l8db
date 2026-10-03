import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ResponseAction } from "./beui/agents/streaming-response";

export function AiCopyAction({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <ResponseAction
      label={copied ? "Kopiert" : label}
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </ResponseAction>
  );
}
