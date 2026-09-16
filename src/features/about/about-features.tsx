import {
  ArrowDownRight,
  Command,
  GitBranch,
  KeyRound,
  Network,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { NotificationStack } from "@/components/motion/notification-stack";
import { Tooltip } from "@/components/motion/tooltip";
import { cn } from "@/lib/utils";

const CODE_LINES = [
  ["01", "select", "customer_id, count(*)"],
  ["02", "from", "events"],
  ["03", "where", "created_at > now() - interval '30 days'"],
  ["04", "group by", "customer_id"],
  ["05", "order by", "count desc;"],
];

export function AboutFeatures() {
  const reduce = useReducedMotion();

  return (
    <section
      id="features"
      className="about-section mx-auto w-full max-w-[1360px] px-5 py-24 sm:px-8 lg:px-10 lg:py-32"
    >
      <div className="max-w-[43rem]">
        <p className="about-kicker">Everything in view</p>
        <h2 className="mt-4 text-4xl font-semibold tracking-[-0.07em] sm:text-6xl">
          Weniger Tabs.
          <span className="block text-current/42">Mehr Klarheit.</span>
        </h2>
        <p className="mt-5 max-w-[35rem] text-sm leading-6 text-current/52 sm:text-base">
          l8db bringt Query, Schema und Ergebnis in einen Arbeitsfluss, der sich nach deinem Denken
          richtet.
        </p>
      </div>

      <div className="mt-14 grid gap-4 md:grid-cols-12">
        <motion.article
          initial={{ opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="about-feature-card about-feature-code md:col-span-7"
        >
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-cyan-200/55">
                Query workspace
              </span>
              <h3 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-white">
                SQL ohne Reibung.
              </h3>
            </div>
            <Tooltip content="Formatieren mit ⌘⇧F" side="top">
              <button type="button" aria-label="SQL formatieren" className="about-icon-button">
                <Sparkles className="size-4" />
              </button>
            </Tooltip>
          </div>
          <div className="about-code-window mt-9">
            <div className="flex items-center gap-1.5 border-b border-white/[0.07] px-4 py-2">
              <span className="size-1.5 rounded-full bg-red-300/60" />
              <span className="size-1.5 rounded-full bg-amber-200/60" />
              <span className="size-1.5 rounded-full bg-emerald-300/60" />
              <span className="ml-2 font-mono text-[9px] text-white/28">retention_30d.sql</span>
            </div>
            <div className="space-y-1 px-4 py-4 font-mono text-[10px] leading-5 sm:text-[11px]">
              {CODE_LINES.map(([line, keyword, value], index) => (
                <motion.div
                  key={line}
                  initial={{ opacity: 0, x: reduce ? 0 : 12 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.08, duration: 0.35 }}
                  className="grid grid-cols-[1.5rem_4.6rem_1fr] gap-2"
                >
                  <span className="text-white/20">{line}</span>
                  <span className="text-cyan-200">{keyword}</span>
                  <span className="truncate text-white/55">{value}</span>
                </motion.div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-white/[0.07] px-4 py-2 text-[9px] text-white/32">
              <span>⌘ Enter to run</span>
              <AnimatedBadge
                status="success"
                size="sm"
                className="border-white/10 bg-white/[0.06] text-emerald-200"
              >
                12 ms
              </AnimatedBadge>
            </div>
          </div>
          <p className="mt-6 max-w-[28rem] text-sm leading-6 text-white/48">
            Monaco-Editor, Verlauf, Formatierung und Ergebnisse, ohne zwischen Tools zu wechseln.
          </p>
        </motion.article>

        <motion.article
          initial={{ opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="about-feature-card about-feature-map md:col-span-5"
        >
          <div className="relative z-10">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-current/40">
                  Schema map
                </span>
                <h3 className="mt-2 text-2xl font-semibold tracking-[-0.05em]">
                  Beziehungen, nicht Vermutungen.
                </h3>
              </div>
              <Network className="size-5 text-current/45" />
            </div>
            <p className="mt-4 max-w-[20rem] text-sm leading-6 text-current/50">
              Fremdschlüssel werden zu einer Karte, die du lesen kannst.
            </p>
          </div>
          <div className="about-schema-map" aria-hidden>
            <motion.div
              className="about-schema-line about-schema-line-one"
              animate={reduce ? undefined : { opacity: [0.25, 0.8, 0.25] }}
              transition={reduce ? undefined : { duration: 3, repeat: Number.POSITIVE_INFINITY }}
            />
            <motion.div
              className="about-schema-line about-schema-line-two"
              animate={reduce ? undefined : { opacity: [0.15, 0.65, 0.15] }}
              transition={
                reduce ? undefined : { duration: 3.4, repeat: Number.POSITIVE_INFINITY, delay: 0.5 }
              }
            />
            {[
              ["customers", "about-schema-node-one"],
              ["orders", "about-schema-node-two"],
              ["events", "about-schema-node-three"],
            ].map(([label, position], index) => (
              <motion.div
                key={label}
                className={cn("about-schema-node", position)}
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{
                  delay: 0.2 + index * 0.12,
                  type: "spring",
                  stiffness: 250,
                  damping: 20,
                }}
              >
                <GitBranch className="size-3" />
                {label}
              </motion.div>
            ))}
            <div className="about-schema-core">
              <div className="grid size-8 place-items-center rounded-xl bg-cyan-300 text-[#11151d]">
                <Network className="size-4" />
              </div>
            </div>
          </div>
        </motion.article>

        <motion.article
          initial={{ opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          className="about-feature-card about-feature-alert md:col-span-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-current/40">
                Stay in flow
              </span>
              <h3 className="mt-2 text-xl font-semibold tracking-[-0.05em]">
                Relevantes bleibt oben.
              </h3>
            </div>
            <ArrowDownRight className="size-5 text-current/35" />
          </div>
          <p className="mt-4 text-sm leading-6 text-current/48">
            Abfragen, Updates und Statusmeldungen erscheinen dort, wo du sie erwartest.
          </p>
          <NotificationStack
            className="mt-7 max-w-none"
            defaultExpanded
            maxVisible={3}
            collapsedLabel="Aktivität"
            expandedLabel="Alle Meldungen"
            items={[
              {
                id: "query",
                title: "Query abgeschlossen",
                description: "public.customers · 4 Zeilen · 12 ms",
                trailing: (
                  <AnimatedBadge status="success" size="sm" showIcon={false}>
                    Ready
                  </AnimatedBadge>
                ),
              },
              {
                id: "tunnel",
                title: "SSH-Tunnel aktiv",
                description: "analytics-prod über Port 5433",
                trailing: (
                  <AnimatedBadge status="info" size="sm" showIcon={false}>
                    Secure
                  </AnimatedBadge>
                ),
              },
              {
                id: "schema",
                title: "Schema aktualisiert",
                description: "14 Tabellen in public erkannt",
              },
            ]}
          />
        </motion.article>

        <motion.article
          initial={{ opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
          className="about-feature-card about-feature-security md:col-span-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-current/40">
                Local first
              </span>
              <h3 className="mt-2 text-xl font-semibold tracking-[-0.05em]">Sicher by design.</h3>
            </div>
            <ShieldCheck className="size-5 text-emerald-500" />
          </div>
          <div className="mt-9 space-y-2">
            {[
              ["TLS mit System-Zertifikaten", "verified"],
              ["SSH-Tunnel pro Verbindung", "active"],
              ["Secrets im OS-Keychain", "locked"],
            ].map(([label, state]) => (
              <div
                key={label}
                className="flex items-center justify-between rounded-xl border border-current/10 bg-current/[0.035] px-3 py-2.5 text-xs"
              >
                <span className="flex items-center gap-2 text-current/62">
                  <KeyRound className="size-3.5 text-current/35" />
                  {label}
                </span>
                <AnimatedBadge status="success" size="sm" showIcon={false}>
                  {state}
                </AnimatedBadge>
              </div>
            ))}
          </div>
        </motion.article>

        <motion.article
          initial={{ opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="about-feature-card about-feature-keys md:col-span-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-current/40">
                Keyboard native
              </span>
              <h3 className="mt-2 text-xl font-semibold tracking-[-0.05em]">
                Dein Rhythmus bleibt intakt.
              </h3>
            </div>
            <Command className="size-5 text-current/35" />
          </div>
          <div className="mt-8 grid grid-cols-2 gap-2">
            {["⌘ K", "⌘ Enter", "⌘ ⇧ F", "⌘ P"].map((shortcut) => (
              <div
                key={shortcut}
                className="rounded-xl border border-current/10 bg-current/[0.035] px-3 py-3 font-mono text-xs text-current/60"
              >
                {shortcut}
              </div>
            ))}
          </div>
          <p className="mt-5 text-sm leading-6 text-current/48">
            Suche, formatieren, ausführen, wechseln. Der Cursor bleibt bei dir.
          </p>
        </motion.article>
      </div>
    </section>
  );
}
