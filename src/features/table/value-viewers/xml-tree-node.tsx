import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

const CHILD_LIMIT = 500;

function meaningfulChildren(node: Node): Node[] {
  const out: Node[] = [];
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && !child.textContent?.trim()) continue;
    out.push(child);
  }
  return out;
}

function renderAttributes(element: Element) {
  return Array.from(element.attributes).map((attr) => (
    <span key={attr.name}>
      {" "}
      <span className="text-amber-700 dark:text-amber-400">{attr.name}</span>
      <span className="text-muted-foreground">=</span>
      <span className="text-emerald-700 dark:text-emerald-400">"{attr.value}"</span>
    </span>
  ));
}

export function XmlTreeNode({ node, depth }: { node: Node; depth: number }) {
  const [open, setOpen] = useState(depth < 3);
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE)
    return (
      <div className="pl-5 whitespace-pre-wrap break-words text-foreground">
        {node.nodeType === Node.CDATA_SECTION_NODE
          ? `<![CDATA[${node.textContent ?? ""}]]>`
          : node.textContent?.trim()}
      </div>
    );
  if (node.nodeType === Node.COMMENT_NODE)
    return (
      <div className="pl-5 text-muted-foreground italic">{`<!--${node.textContent ?? ""}-->`}</div>
    );
  if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE)
    return (
      <div className="pl-5 text-muted-foreground">{`<?${(node as ProcessingInstruction).target} ${node.textContent ?? ""}?>`}</div>
    );
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as Element;
  const children = meaningfulChildren(element);
  const onlyText =
    children.length === 1 && children[0].nodeType === Node.TEXT_NODE
      ? (children[0].textContent ?? "").trim()
      : null;
  const tag = <span className="text-sky-700 dark:text-sky-400">{element.tagName}</span>;
  if (!children.length || onlyText !== null)
    return (
      <div className="pl-5 break-words">
        <span className="text-muted-foreground">&lt;</span>
        {tag}
        {renderAttributes(element)}
        {children.length ? (
          <>
            <span className="text-muted-foreground">&gt;</span>
            <span className="text-foreground">{onlyText}</span>
            <span className="text-muted-foreground">&lt;/</span>
            {tag}
            <span className="text-muted-foreground">&gt;</span>
          </>
        ) : (
          <span className="text-muted-foreground">/&gt;</span>
        )}
      </div>
    );
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-start gap-1 text-left hover:bg-muted/60"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDownIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="break-words">
          <span className="text-muted-foreground">&lt;</span>
          {tag}
          {renderAttributes(element)}
          <span className="text-muted-foreground">&gt;</span>
          {!open && <span className="text-muted-foreground"> … {children.length} Knoten</span>}
        </span>
      </button>
      {open && (
        <div className="ml-[7px] border-l border-border/70 pl-2">
          {children.slice(0, CHILD_LIMIT).map((child, index) => (
            <XmlTreeNode key={index} node={child} depth={depth + 1} />
          ))}
          {children.length > CHILD_LIMIT && (
            <div className="pl-5 text-muted-foreground italic">
              … {children.length - CHILD_LIMIT} weitere Knoten
            </div>
          )}
        </div>
      )}
    </div>
  );
}
