import { invoke } from "./core";

export interface DockEntry {
  id: string;
  name: string;
}

export function openAppWindow(connectionId?: string): Promise<void> {
  return invoke<void>("open_app_window", { connection: connectionId ?? null });
}

export function setDockRecents(recents: DockEntry[]): Promise<void> {
  return invoke<void>("set_dock_recents", { recents });
}

export function setWindowConnection(id: string | null): Promise<void> {
  return invoke<void>("set_window_connection", { id });
}

export function connectionInOtherWindow(id: string): Promise<boolean> {
  return invoke<boolean>("connection_in_other_window", { id });
}
