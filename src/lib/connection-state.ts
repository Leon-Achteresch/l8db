export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "error";

interface ConnectionStatusInput {
  connectionId: string;
  activeId: string | null;
  isSwitching: boolean;
  targetId: string | null;
  errorId: string | null;
}

export function connectionStatusFor({
  connectionId,
  activeId,
  isSwitching,
  targetId,
  errorId,
}: ConnectionStatusInput): ConnectionStatus {
  if (errorId === connectionId) return "error";
  if (isSwitching && targetId === connectionId) return "connecting";
  if (isSwitching && activeId === connectionId) return "disconnecting";
  if (activeId === connectionId) return "connected";
  return "disconnected";
}
