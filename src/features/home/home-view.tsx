import { Navigate } from "@tanstack/react-router";
import { StorageDashboard } from "@/features/storage/storage-dashboard";
import { providerFor } from "@/lib/connection-url";
import { useActiveConnection } from "@/lib/connections";
import { ConnectedDashboard } from "./connected-dashboard";

export function HomeView() {
  const activeConnection = useActiveConnection();
  if (!activeConnection) return <Navigate to="/connections" replace />;
  if (providerFor(activeConnection).capabilities.object_storage)
    return <StorageDashboard key={activeConnection.id} connection={activeConnection} />;
  return <ConnectedDashboard key={activeConnection.id} connection={activeConnection} />;
}
