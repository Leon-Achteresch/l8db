export function csvCheckDevelopmentSelected(development: boolean, search: string): boolean {
  return (
    development &&
    search.length < 8192 &&
    new URLSearchParams(search).get("csv-check-development") === "1"
  );
}

export function arrayEditorDevelopmentSelected(development: boolean, search: string): boolean {
  if (!development || search.length >= 8192) return false;
  const parameters = new URLSearchParams(search);
  return (
    parameters.get("array-editor-development") === "1" && !parameters.has("csv-check-development")
  );
}

export function routineResultDevelopmentSelected(development: boolean, search: string): boolean {
  return development && search === "?routine-result-development=1";
}
