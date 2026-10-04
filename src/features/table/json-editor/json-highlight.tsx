export function JsonHighlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase();
  if (!needle) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let index = 0;
  let hit = lower.indexOf(needle);
  while (hit !== -1) {
    if (hit > index) parts.push(text.slice(index, hit));
    parts.push(
      <mark
        key={hit}
        className="rounded-sm bg-yellow-300/70 px-px text-inherit dark:bg-yellow-500/40"
      >
        {text.slice(hit, hit + needle.length)}
      </mark>,
    );
    index = hit + needle.length;
    hit = lower.indexOf(needle, index);
  }
  if (index < text.length) parts.push(text.slice(index));
  return <>{parts}</>;
}
