import type { IconNode } from "lucide";
import { MorphIcon } from "morphicons/react";
import { useEffect, useState } from "react";
import { loadLucideIcon } from "@/lib/ai/chat-icon";
import { cn } from "@/lib/utils";

export function AiChatIcon({ name, className }: { name: string; className?: string }) {
  const [icon, setIcon] = useState<{ name: string; node: IconNode | null }>();
  useEffect(() => {
    let live = true;
    void loadLucideIcon(name).then((node) => live && setIcon({ name, node }));
    return () => {
      live = false;
    };
  }, [name]);
  const node = icon?.name === name ? icon.node : null;
  return (
    <span aria-hidden className={cn("inline-grid shrink-0 place-items-center", className)}>
      {node && <MorphIcon icon={node} className="size-full" />}
    </span>
  );
}
