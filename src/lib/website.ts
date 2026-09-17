export function websiteUrl(path = ""): string {
  const base =
    import.meta.env.VITE_WEBSITE_URL ??
    (import.meta.env.DEV ? "http://localhost:3000" : "https://l8db.leon-achteresch.de");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base.replace(/\/+$/, "")}${path ? normalized : ""}`;
}
