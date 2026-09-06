import {
  FileDown,
  GitBranch,
  Network,
  ShieldCheck,
  SquareTerminal,
  Table2,
} from "lucide-react";
import { motion } from "motion/react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const FEATURES = [
  {
    icon: Table2,
    title: "Tabellen-Browser",
    description:
      "Zeilen filtern, sortieren und seitenweise durchblättern — mit Inline-Editing und Transaktions-Panel.",
    span: true,
  },
  {
    icon: SquareTerminal,
    title: "SQL-Arbeitsplatz",
    description:
      "Monaco-Editor mit Highlighting, Formatierung, Verlauf und gespeicherten Queries.",
    span: true,
  },
  {
    icon: Network,
    title: "ER-Diagramm",
    description: "Beziehungen und Fremdschlüssel eines Schemas visuell erkunden.",
    span: false,
  },
  {
    icon: GitBranch,
    title: "EXPLAIN & Diagnose",
    description: "Pläne als Baum mit Kosten, Timings und Sessions- sowie Lock-Monitor.",
    span: false,
  },
  {
    icon: ShieldCheck,
    title: "Sicher by Design",
    description: "TLS mit System-Zertifikaten, SSH-Tunnel, Secrets im OS-Keychain.",
    span: false,
  },
  {
    icon: FileDown,
    title: "Export & Verwaltung",
    description: "CSV-/JSON-Export, Extensions, Rollen, Partitionen und Replikation.",
    span: false,
  },
];

export function AboutFeatures() {
  return (
    <section>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Funktionen</p>
          <h2 className="mt-1.5 text-xl font-semibold tracking-tight">
            Alles für den Arbeitsalltag
          </h2>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((feature, index) => (
          <motion.div
            key={feature.title}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{
              duration: 0.45,
              delay: (index % 4) * 0.06,
              ease: [0.22, 1, 0.36, 1],
            }}
            className={feature.span ? "sm:col-span-1 lg:col-span-2" : undefined}
          >
            <Card className="h-full gap-4 py-5 transition-colors hover:border-primary/40">
              <CardHeader className="px-5">
                <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
                  <feature.icon className="size-4.5" />
                </span>
                <CardTitle className="mt-3 text-[15px]">{feature.title}</CardTitle>
                <CardDescription className="mt-1 text-[13px] leading-relaxed">
                  {feature.description}
                </CardDescription>
              </CardHeader>
            </Card>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
