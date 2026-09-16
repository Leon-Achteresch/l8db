const DOCS_BASE_URL = (
  import.meta.env.VITE_DOCS_URL ?? "https://l8db.leon-achteresch.de/docs"
).replace(/\/$/, "");

export function docsUrl(path = "") {
  const suffix = path.replace(/^\//, "");
  return suffix ? `${DOCS_BASE_URL}/${suffix}` : DOCS_BASE_URL;
}
