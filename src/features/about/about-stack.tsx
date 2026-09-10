import { motion } from "motion/react";
import { Badge } from "@/components/ui/badge";

const STACK = [
  { name: "Tauri v2", detail: "Nativer Shell" },
  { name: "Rust", detail: "tokio · bb8" },
  { name: "React 19", detail: "Frontend" },
  { name: "TanStack", detail: "Router · Query" },
  { name: "Monaco", detail: "SQL-Editor" },
  { name: "Tailwind v4", detail: "shadcn/ui" },
];

export function AboutStack() {
  return (
    <section className="overflow-hidden rounded-3xl border bg-card">
      <div className="px-6 pb-2 pt-6 sm:px-8 sm:pt-8">
        <p className="eyebrow">Technologie</p>
        <h2 className="mt-1.5 text-xl font-semibold tracking-tight">
          Modern gebaut, bewusst schlank
        </h2>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
          Ein schlanker Rust-Kern für Verbindungen und Pools, ein schnelles React-Frontend
          für alles andere. Keine Electron-Schwere, keine Cloud-Abhängigkeit.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 px-6 py-6 sm:px-8 sm:pb-8">
        {STACK.map((item, index) => (
          <motion.div
            key={item.name}
            initial={{ opacity: 0, scale: 0.94 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: "-30px" }}
            transition={{ duration: 0.35, delay: index * 0.05 }}
          >
            <Badge
              variant="secondary"
              className="h-auto gap-2 rounded-2xl px-3.5 py-2 text-[13px]"
            >
              <span className="font-semibold text-foreground">{item.name}</span>
              <span className="font-normal text-muted-foreground">{item.detail}</span>
            </Badge>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
