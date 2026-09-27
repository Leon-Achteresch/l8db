import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AppwriteView } from "./appwrite-view";
import { PocketBaseView } from "./pocketbase-view";
import { SupabaseView } from "./supabase-view";

export function BaasView() {
  const [provider, setProvider] = useState<"supabase" | "appwrite" | "pocketbase">("supabase");

  return (
    <main className="h-full min-h-0 flex-1 overflow-auto bg-background">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-6 pt-8 pb-6 lg:px-9">
        <div className="flex gap-2" role="tablist" aria-label="BaaS-Anbieter">
          {(["supabase", "appwrite", "pocketbase"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={provider === item}
              onClick={() => setProvider(item)}
              className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${provider === item ? "border-primary/50 bg-primary/10 text-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}
            >
              {item === "supabase" ? "Supabase" : item === "appwrite" ? "Appwrite" : "PocketBase"}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/connections">Datenbankverbindungen</Link>
        </Button>
      </div>
      {provider === "supabase" ? (
        <SupabaseView />
      ) : provider === "appwrite" ? (
        <AppwriteView />
      ) : (
        <PocketBaseView />
      )}
    </main>
  );
}
