import { motion } from "motion/react";
import changelog from "../../../CHANGELOG.md?raw";
import { Markdown } from "@/components/markdown";
import { SPRING_LAYOUT } from "@/lib/ease";

export function ReleaseNotesView() {
  return (
    <main className="workspace-canvas h-full w-full min-w-0 overflow-y-auto">
      <div className="w-full px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Release Notes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Alle veröffentlichten Änderungen dieser App.
        </p>
        <motion.div
          layout
          transition={{ layout: SPRING_LAYOUT }}
          className="mt-6 rounded-2xl border border-border/80 bg-card px-5 py-5 shadow-sm"
        >
          <Markdown source={changelog} />
        </motion.div>
      </div>
    </main>
  );
}
