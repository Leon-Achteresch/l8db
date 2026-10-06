import { useEffect, useRef } from "react";
import { useAiFlashStore } from "@/lib/automation/ai-activity";

interface Props {
  id: string;
  reveal?: boolean;
  neon?: boolean;
}

export function AiFlash({ id, reveal = false, neon = false }: Props) {
  const nonce = useAiFlashStore((state) => state.flashes[id]);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (nonce && reveal) ref.current?.scrollIntoView({ block: "nearest" });
  }, [nonce, reveal]);

  if (!nonce) return null;
  return (
    <span
      key={nonce}
      ref={ref}
      aria-hidden
      className={`${neon ? "ai-neon z-20" : "ai-flash"} pointer-events-none absolute inset-0 rounded-[inherit]`}
    />
  );
}
