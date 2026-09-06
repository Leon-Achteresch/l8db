import { Safari } from "@/components/ui/safari";

export function OnboardingHero() {
  return (
    <section
      className="relative flex w-full flex-col items-center justify-center px-6 pb-20 pt-28 text-center"
      style={{ minHeight: "82vh" }}
    >
      <div className="flex flex-col items-center gap-5">
        <div className="rounded-full border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground">
          Native DB Desktop Client
        </div>

        <h1
          className="font-black tracking-tighter leading-none text-foreground"
          style={{ fontSize: "clamp(5rem, 13vw, 9rem)" }}
        >
          l8db
        </h1>

        <p className="text-xl font-medium text-muted-foreground">
          Manage your databases with <span className="font-bold text-foreground">precision</span>
        </p>

        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          Browse tables, run queries, inspect schemas, manage users, and visualize ER diagrams —
          from one native desktop app.
        </p>
      </div>

      <div className="mt-16 w-full max-w-[52rem] px-4">
        <Safari url="l8db · app" mode="simple" />
      </div>
    </section>
  );
}
