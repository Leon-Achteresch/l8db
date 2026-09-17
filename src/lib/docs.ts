export function docsUrl(path = ""): string {
  const base =
    import.meta.env.VITE_DOCS_URL ??
    (import.meta.env.DEV ? "http://localhost:3000/docs" : "https://l8db.leon-achteresch.de/docs");
  const suffix = path.replace(/^\//, "");
  return suffix ? `${base.replace(/\/+$/, "")}/${suffix}` : base;
}
