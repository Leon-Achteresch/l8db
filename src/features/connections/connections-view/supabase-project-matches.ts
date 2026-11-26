import type { BaasConnection } from "@/features/baas/use-baas-connections";
import { supabaseReferenceFromUrl } from "@/features/baas/use-supabase-database";
import type { SavedConnection } from "@/lib/connections/types";

function hostKey(host: string, name: string) {
  return `${host}\0${name}`;
}

export function matchSupabaseProjects(connections: SavedConnection[], projects: BaasConnection[]) {
  const databaseByProject = new Map<BaasConnection, SavedConnection>();
  const targets = new Map<string, BaasConnection[]>();
  const localNames = new Set<string>();
  let hasCloudReference = false;

  function register(key: string, project: BaasConnection) {
    const matches = targets.get(key);
    if (matches) matches.push(project);
    else targets.set(key, [project]);
  }

  for (const project of projects) {
    if (project.provider !== "supabase" || !project.id) continue;
    if (/^[a-z0-9]{20}$/.test(project.id)) {
      register(project.id, project);
      hasCloudReference = true;
    }
    if (project.url) {
      try {
        const { hostname } = new URL(project.url);
        register(hostKey(hostname, project.name), project);
        register(hostKey(`db.${hostname}`, project.name), project);
        localNames.add(project.name);
      } catch {}
    }
  }
  if (!targets.size) return { visible: connections, databaseByProject };

  function link(key: string | null, connection: SavedConnection) {
    const matches = key && targets.get(key);
    if (!matches) return false;
    for (const project of matches) {
      if (!databaseByProject.has(project)) databaseByProject.set(project, connection);
    }
    return true;
  }

  const visible = connections.filter((connection) => {
    const matchesName = localNames.has(connection.name);
    if (connection.kind !== "postgres" || (!hasCloudReference && !matchesName)) return true;
    let url: URL;
    try {
      url = new URL(connection.connectionString);
    } catch {
      return true;
    }
    const cloud = hasCloudReference && link(supabaseReferenceFromUrl(url), connection);
    const local = matchesName && link(hostKey(url.hostname, connection.name), connection);
    return !cloud && !local;
  });
  return { visible, databaseByProject };
}
