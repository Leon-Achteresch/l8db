import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Hash } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FirebaseProfile } from "@/lib/db";
import { FirebaseAuthView } from "./firebase-auth-view";
import { FirebaseFirestoreView } from "./firebase-firestore-view";
import { FirebaseFunctionsView } from "./firebase-functions-view";
import { FirebaseHostingView } from "./firebase-hosting-view";
import { FirebaseStorageView } from "./firebase-storage-view";

export function FirebaseProjectView({ profile }: { profile: FirebaseProfile }) {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              {profile.displayName || profile.projectId}
            </h2>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{profile.projectId}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void openUrl(
                `https://console.firebase.google.com/project/${encodeURIComponent(profile.projectId)}/overview`,
              )
            }
          >
            Firebase-Konsole <ExternalLink className="size-3.5" />
          </Button>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <div className="rounded-xl border bg-background/50 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Hash className="size-3.5" /> Projektnummer
            </div>
            <p className="mt-2 font-mono text-sm font-medium">
              {profile.projectNumber ?? "Nicht angegeben"}
            </p>
          </div>
          <div className="rounded-xl border bg-background/50 p-3">
            <p className="text-xs text-muted-foreground">Status</p>
            <p className="mt-2 text-sm font-medium">{profile.state ?? "Nicht angegeben"}</p>
          </div>
        </div>
      </section>
      <div data-baas-section="storage" className="scroll-mt-6">
        <FirebaseStorageView projectId={profile.projectId} />
      </div>
      <div data-baas-section="database" className="scroll-mt-6">
        <FirebaseFirestoreView projectId={profile.projectId} />
      </div>
      <div data-baas-section="auth" className="scroll-mt-6">
        <FirebaseAuthView projectId={profile.projectId} />
      </div>
      <div data-baas-section="functions" className="scroll-mt-6">
        <FirebaseFunctionsView projectId={profile.projectId} />
      </div>
      <div data-baas-section="hosting" className="scroll-mt-6">
        <FirebaseHostingView projectId={profile.projectId} />
      </div>
    </div>
  );
}
