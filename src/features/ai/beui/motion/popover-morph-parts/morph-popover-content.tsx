import { AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MorphPopoverSurface } from "./morph-popover-surface";
import { type MorphPopoverContentProps, useMorphContext } from "./shared";
export function MorphPopoverContent(props: MorphPopoverContentProps) {
  const ctx = useMorphContext("MorphPopoverContent");
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => setPortalReady(true), []);
  if (!portalReady) return null;
  return createPortal(
    <AnimatePresence>{ctx.open && <MorphPopoverSurface {...props} />}</AnimatePresence>,
    document.body,
  );
}
