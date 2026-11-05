import { Sparkles } from "lucide-react";

export function AiEmptyHero({ connectionName }: { connectionName?: string }) {
  return (
    <div className="px-1 pb-5">
      <span className="mb-4 grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Sparkles className="size-[18px]" />
      </span>
      <h2 className="text-balance text-[22px] font-semibold leading-tight tracking-[-0.02em]">
        {connectionName ? `Was möchtest du über ${connectionName} wissen?` : "Wie kann ich helfen?"}
      </h2>
      <p className="mt-1.5 text-[13px] text-muted-foreground">
        Frag in Alltagssprache – du bekommst Antwort, Diagramm und SQL.
      </p>
    </div>
  );
}
