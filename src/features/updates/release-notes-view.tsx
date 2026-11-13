import { SpotlightOpenButton } from "@/features/discovery/spotlight/spotlight-open-button";
import { FeatureVideoGallery } from "@/features/updates/feature-video-gallery";
import { ReleaseEntry } from "@/features/updates/release-entry";
import { parseChangelog } from "@/lib/changelog";
import changelog from "../../../CHANGELOG.md?raw";

const RELEASES = parseChangelog(changelog);

export function ReleaseNotesView() {
  return (
    <main className="workspace-canvas h-full w-full min-w-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Release Notes</h1>
          <SpotlightOpenButton className="ml-auto" />
        </div>
        <FeatureVideoGallery />
        <ol className="mt-10">
          {RELEASES.map((release, index) => (
            <ReleaseEntry key={release.version} release={release} latest={index === 0} />
          ))}
        </ol>
      </div>
    </main>
  );
}
