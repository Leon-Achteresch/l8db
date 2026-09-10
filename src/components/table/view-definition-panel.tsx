import { useState } from "react";

import { AnimatePresence, motion } from "motion/react";
import {
  ChevronDownIcon,
  CodeIcon,
  CopyIcon,
  CheckIcon,
} from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { useViewDefinitionQuery } from "@/lib/queries";

interface ViewDefinitionPanelProps {
  schema: string;
  view: string;
}

export function ViewDefinitionPanel({
  schema,
  view,
}: ViewDefinitionPanelProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { data: definition, isLoading } = useViewDefinitionQuery(schema, view);

  const handleCopy = async () => {
    if (!definition) return;
    await navigator.clipboard.writeText(definition);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex min-h-0 max-h-full flex-col border-b bg-muted/30">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-foreground"
        >
          <CodeIcon className="size-4 text-muted-foreground" />
          View-Definition
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="inline-flex"
          >
            <ChevronDownIcon className="size-4 text-muted-foreground" />
          </motion.span>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="view-def-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.26, ease: [0.32, 0.72, 0, 1] },
              opacity: { duration: 0.18 },
            }}
            className="overflow-hidden"
          >
            <div className="relative px-3 pb-3">
              {isLoading ? (
                <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                  <Spinner />
                  Lade Definition…
                </div>
              ) : definition ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleCopy}
                    className="absolute top-1 right-4"
                    aria-label="SQL kopieren"
                  >
                    {copied ? (
                      <CheckIcon className="size-3.5" />
                    ) : (
                      <CopyIcon className="size-3.5" />
                    )}
                  </Button>
                  <pre className="max-h-48 overflow-auto rounded-md border bg-background p-3 font-mono text-xs leading-relaxed text-foreground">
                    {definition}
                  </pre>
                </>
              ) : (
                <p className="py-2 text-sm text-muted-foreground">
                  Definition nicht verfügbar.
                </p>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
