import { getRouteApi, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AppwriteView } from "./appwrite-view";
import { ConvexView } from "./convex-view";
import { FirebaseView } from "./firebase-view";
import { PocketBaseView } from "./pocketbase-view";
import { SupabaseView } from "./supabase-view";

const route = getRouteApi("/baas");

export function BaasView() {
  const { provider, id, section } = route.useSearch();

  useEffect(() => {
    if (!section) return;
    const started = Date.now();
    const timer = setInterval(() => {
      const target = document.querySelector(`[data-baas-section~="${section}"]`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      if (target || Date.now() - started > 8000) clearInterval(timer);
    }, 200);
    return () => clearInterval(timer);
  }, [section]);

  return (
    <main className="h-full min-h-0 flex-1 overflow-auto bg-background">
      <div className="mx-auto max-w-[1400px] px-6 pt-8 pb-6 lg:px-9">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/connections">
            <ArrowLeft className="size-3.5" />
            Verbindungen
          </Link>
        </Button>
      </div>
      {provider === "supabase" ? (
        <SupabaseView key={id} initialId={id} />
      ) : provider === "appwrite" ? (
        <AppwriteView key={id} initialId={id} />
      ) : provider === "pocketbase" ? (
        <PocketBaseView key={id} initialId={id} />
      ) : provider === "convex" ? (
        <ConvexView key={id} initialId={id} />
      ) : (
        <FirebaseView key={id} initialId={id} />
      )}
    </main>
  );
}
