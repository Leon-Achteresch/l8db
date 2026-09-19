import { cn } from "@/lib/utils";

export function ThesvgIcon({ svg, className }: { svg: string; className?: string }) {
  const normalized = svg.replace(/fill="#(?:fff|ffffff)"/gi, 'fill="currentColor"');
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center text-foreground [&_svg]:h-full [&_svg]:w-full",
        className,
      )}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: static SVG from the bundled thesvg icon set, no user input
      dangerouslySetInnerHTML={{ __html: normalized }}
    />
  );
}
