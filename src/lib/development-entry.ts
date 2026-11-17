export function csvCheckDevelopmentSelected(development: boolean, search: string): boolean {
  return (
    development &&
    search.length < 8192 &&
    new URLSearchParams(search).get("csv-check-development") === "1"
  );
}
