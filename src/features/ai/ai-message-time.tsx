export function AiMessageTime({ at }: { at?: number }) {
  if (!at) return null;
  const date = new Date(at);
  return (
    <time
      dateTime={date.toISOString()}
      title={date.toLocaleString()}
      className="px-1 text-xs text-muted-foreground tabular-nums"
    >
      {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </time>
  );
}
