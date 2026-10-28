export function SupabaseSectionTitle({ section, part }: { section: string; part?: string }) {
  return (
    <>
      {section}
      {part && <span className="font-normal text-muted-foreground">/ {part}</span>}
    </>
  );
}
