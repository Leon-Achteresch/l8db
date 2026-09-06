import { AboutFeatures } from "@/features/about/about-features";
import { AboutFooter } from "@/features/about/about-footer";
import { AboutHero } from "@/features/about/about-hero";
import { AboutStack } from "@/features/about/about-stack";

export function AboutView() {
  return (
    <main className="workspace-canvas h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
        <AboutHero />
        <AboutFeatures />
        <AboutStack />
        <AboutFooter />
      </div>
    </main>
  );
}
