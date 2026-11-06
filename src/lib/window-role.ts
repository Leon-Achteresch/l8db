const windowParams = new URLSearchParams(
  typeof window === "undefined" ? "" : (window.location?.search ?? ""),
);

export const windowConnectionId: string | null = windowParams.get("connection");

export const isMainWindow = windowConnectionId === null && !windowParams.has("window");
