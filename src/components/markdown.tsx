import type { ReactNode } from "react";
import { parseMarkdown, type MdInline } from "@/lib/markdown";
import { cn } from "@/lib/utils";

function renderInline(nodes: MdInline[]): ReactNode {
  return nodes.map((node, index) => {
    if (node.t === "text") return <span key={index}>{node.v}</span>;
    if (node.t === "strong") {
      return (
        <strong key={index} className="font-semibold text-foreground">
          {renderInline(node.children)}
        </strong>
      );
    }
    if (node.t === "em") {
      return (
        <em key={index}>
          {renderInline(node.children)}
        </em>
      );
    }
    if (node.t === "code") {
      return (
        <code
          key={index}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {node.v}
        </code>
      );
    }
    return (
      <a
        key={index}
        href={node.href}
        target="_blank"
        rel="noreferrer"
        className="text-foreground underline underline-offset-3 hover:text-primary"
      >
        {renderInline(node.children)}
      </a>
    );
  });
}

const HEADING = {
  1: "mt-4 text-xl font-semibold tracking-tight text-foreground first:mt-0",
  2: "mt-4 text-base font-semibold tracking-tight text-foreground first:mt-0",
  3: "mt-3 text-sm font-semibold text-foreground first:mt-0",
  4: "mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:mt-0",
} as const;

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className={cn("text-sm leading-relaxed text-muted-foreground", className)}>
      {blocks.map((block, index) => {
        if (block.t === "h") {
          const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4";
          return (
            <Tag key={index} className={HEADING[block.level]}>
              {renderInline(block.children)}
            </Tag>
          );
        }
        if (block.t === "ul") {
          return (
            <ul key={index} className="mt-2 list-disc space-y-1 pl-5 first:mt-0">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  {renderInline(item)}
                </li>
              ))}
            </ul>
          );
        }
        if (block.t === "hr") {
          return <hr key={index} className="my-4 border-border" />;
        }
        if (block.t === "pre") {
          return (
            <pre
              key={index}
              className="mt-3 overflow-x-auto rounded-xl bg-muted px-3 py-2 font-mono text-xs text-foreground first:mt-0"
            >
              {block.v}
            </pre>
          );
        }
        return (
          <p key={index} className="mt-2 first:mt-0">
            {renderInline(block.children)}
          </p>
        );
      })}
    </div>
  );
}
