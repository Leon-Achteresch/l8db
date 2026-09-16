import { motion, useReducedMotion } from "motion/react";
import { ProviderLogo } from "@/components/provider-logo";
import type { DatabaseKind } from "@/lib/db";

const PROVIDERS: { kind: DatabaseKind; label: string }[] = [
  { kind: "postgres", label: "PostgreSQL" },
  { kind: "mysql", label: "MySQL" },
  { kind: "sqlite", label: "SQLite" },
  { kind: "mongodb", label: "MongoDB" },
  { kind: "redis", label: "Redis" },
  { kind: "clickhouse", label: "ClickHouse" },
];

export function AboutStack() {
  const reduce = useReducedMotion();
  const items = [...PROVIDERS, ...PROVIDERS];

  return (
    <section className="about-stack-section overflow-hidden border-y border-current/10">
      <div className="mx-auto grid w-full max-w-[1360px] gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center lg:px-10 lg:py-16">
        <div className="max-w-[32rem]">
          <h2 className="text-3xl font-semibold tracking-[-0.06em] sm:text-4xl">
            Dein Stack bleibt deiner.
          </h2>
          <p className="mt-3 max-w-[29rem] text-sm leading-6 text-current/52">
            Ein Arbeitsplatz für die Datenbanken, die du bereits betreibst. Ohne Cloud-Zwang, ohne
            Übersetzungsverlust.
          </p>
        </div>
        <div
          className="about-marquee relative overflow-hidden"
          role="group"
          aria-label="Unterstützte Datenbanken"
        >
          <motion.div
            className="about-marquee-track flex w-max items-center gap-3"
            animate={reduce ? undefined : { x: ["0%", "-50%"] }}
            transition={
              reduce
                ? undefined
                : { duration: 24, ease: "linear", repeat: Number.POSITIVE_INFINITY }
            }
          >
            {items.map((provider, index) => (
              <div
                key={`${provider.label}-${index}`}
                aria-hidden={index >= PROVIDERS.length}
                className="flex h-14 items-center gap-3 rounded-2xl border border-current/10 bg-current/[0.035] px-4 text-sm font-medium text-current/72"
              >
                <ProviderLogo kind={provider.kind} className="size-5" />
                {provider.label}
              </div>
            ))}
          </motion.div>
        </div>
      </div>
      <div className="about-metrics mx-auto grid w-full max-w-[1360px] grid-cols-2 border-t border-current/10 sm:grid-cols-4">
        {[
          ["11", "Provider-Familien"],
          ["100 %", "lokal ausführbar"],
          ["0", "Cloud-Accounts"],
          ["1", "fokussierter Arbeitsplatz"],
        ].map(([value, label]) => (
          <div key={label} className="border-r border-current/10 px-5 py-5 last:border-0 sm:px-8">
            <p className="text-2xl font-semibold tracking-[-0.06em] text-current/90">{value}</p>
            <p className="mt-1 text-[11px] text-current/42">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
