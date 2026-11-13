import { useState } from "react";
import { Markdown } from "@/components/markdown";
import type { ChangelogGroup } from "@/lib/changelog";

const PREVIEW = 6;

export function ReleaseGroup({ group }: { group: ChangelogGroup }) {
  const [open, setOpen] = useState(false);
  const items = open ? group.items : group.items.slice(0, PREVIEW);
  return (
    <section>
      <h3 className="flex items-center gap-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
        {group.title}
        <span className="tabular-nums opacity-60">{group.items.length}</span>
      </h3>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item}>
            <Markdown source={item} className="text-[13px] leading-5 text-foreground/85" />
          </li>
        ))}
      </ul>
      {group.items.length > PREVIEW && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="mt-2.5 h-6 cursor-pointer rounded-full bg-muted/60 px-2.5 text-xs text-muted-foreground tabular-nums transition-colors hover:bg-muted hover:text-foreground"
        >
          {open ? "Weniger" : `+${group.items.length - PREVIEW} weitere`}
        </button>
      )}
    </section>
  );
}
