import type { ReactNode } from "react";
import { AiPanelHeader } from "@/features/ai/ai-panel-header";

const noop = () => undefined;

export function AiChatLabFrame({
  id,
  title,
  hint,
  heading = "KI-Assistent",
  height = 720,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  heading?: string;
  height?: number;
  children: ReactNode;
}) {
  return (
    <section data-ai-lab={id} aria-labelledby={`ai-lab-${id}`} className="w-[440px] space-y-2">
      <div className="px-1">
        <h3 id={`ai-lab-${id}`} className="text-sm font-semibold">
          {title}
        </h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div
        className="flex flex-col overflow-hidden rounded-xl border bg-background"
        style={{ height }}
      >
        <div>
          <AiPanelHeader
            title={heading}
            view="chat"
            minimized={false}
            busy={false}
            minimizeNew={false}
            minimizeRef={noop}
            onBack={noop}
            onNew={noop}
            onHistory={noop}
            onSettings={noop}
            onFullPage={noop}
            onMinimize={noop}
            onRestore={noop}
            onClose={noop}
          />
        </div>
        {children}
      </div>
    </section>
  );
}
