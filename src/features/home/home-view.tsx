import { Navigate } from "@tanstack/react-router";
import { useActiveConnection } from "@/lib/connections";
import { ConnectedDashboard } from "./connected-dashboard";

export function HomeView() {
  const activeConnection = useActiveConnection();
  if (!activeConnection) return <Navigate to="/connections" replace />;
  return <ConnectedDashboard key={activeConnection.id} connection={activeConnection} />;
}
