import { CircleCheck, CircleX, Loader2, Zap } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { aiCheck } from "@/lib/ai/setup";
import type { AiProfile } from "@/lib/db/ai";

export function AiCheckButton({ profile }: { profile: AiProfile }) {
  const [state, setState] = useState<{ busy: boolean; ok?: boolean; text?: string }>({
    busy: false,
  });
  return (
    <div className="space-y-1.5">
      <Button
        size="xs"
        variant="outline"
        disabled={state.busy}
        onClick={() => {
          setState({ busy: true });
          void aiCheck(profile)
            .then((model) =>
              setState({
                busy: false,
                ok: true,
                text: model ? `Antwort erhalten von ${model}.` : "Antwort erhalten.",
              }),
            )
            .catch((error) =>
              setState({ busy: false, ok: false, text: String(error).replace(/^Error: /, "") }),
            );
        }}
      >
        {state.busy ? <Loader2 className="animate-spin" /> : <Zap />}
        {state.busy ? "Teste Verbindung …" : "Verbindung testen"}
      </Button>
      {state.text && (
        <p
          role="status"
          className={`flex items-start gap-1.5 text-[11px] ${state.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
        >
          {state.ok ? (
            <CircleCheck className="mt-px size-3.5 shrink-0" />
          ) : (
            <CircleX className="mt-px size-3.5 shrink-0" />
          )}
          <span className="min-w-0 break-words">{state.text}</span>
        </p>
      )}
    </div>
  );
}
