import { AboutFeatures } from "@/features/about/about-features";
import { AboutFooter } from "@/features/about/about-footer";
import { AboutHero } from "@/features/about/about-hero";
import { AboutStack } from "@/features/about/about-stack";

export function AboutView() {
  return (
    <main className="workspace-canvas h-full w-full min-w-0 overflow-y-auto">
      <div className="flex w-full flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
        <AboutHero />
        <AboutFeatures />
        <AboutStack />
        <AboutFooter />
      </div>
    </main>
  );
}
