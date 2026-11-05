import { transform } from "sucrase";
import { tokenize } from "../../../packages/ui-plugin-api/src/scan";

type Compiler = typeof import("../../../packages/ui-plugin-api/src/compile");

export function inspectPluginSource(
  compiler: Compiler,
  file: string,
  source: string,
  expectedId?: string,
) {
  const compiled = compiler.compilePlugin(source, file);
  if (!compiled.ok) throw new Error(compiled.error.message);
  const tokens = tokenize(
    transform(source, { transforms: ["typescript", "jsx"], jsxRuntime: "automatic" }).code,
  );
  const start = tokens.findIndex(
    (token, index) => token.value === "export" && tokens[index + 1]?.value === "default",
  );
  let object = start + 2;
  if (tokens[object]?.value === "definePlugin" && tokens[object + 1]?.value === "(") object += 2;
  if (start < 0 || tokens[object]?.value !== "{")
    throw new Error("Vorprüfung benötigt ein direkt exportiertes Plugin-Objekt.");
  let depth = 1;
  let id: string | undefined;
  const http: string[] = [];
  let permissionsDepth = 0;
  let permissionsEnd = false;
  for (let i = object + 1; i < tokens.length && depth; i++) {
    const token = tokens[i];
    if (depth === 1 && token.value === "id" && tokens[i + 1]?.value === ":") {
      if (tokens[i + 2]?.kind !== "string" || ![",", "}"].includes(tokens[i + 3]?.value))
        throw new Error("Plugin-ID muss eine feste Zeichenfolge sein.");
      id = tokens[i + 2].value;
    }
    if (depth === 1 && token.value === "permissions" && tokens[i + 1]?.value === ":") {
      if (tokens[i + 2]?.value !== "{")
        throw new Error("Berechtigungen müssen ein festes Objekt sein.");
      permissionsDepth = 2;
      permissionsEnd = false;
    }
    if (
      token.kind === "punct" &&
      token.value === "..." &&
      (depth === 1 || depth === permissionsDepth)
    )
      throw new Error("Dynamische Plugin-Metadaten sind in der Vorprüfung nicht erlaubt.");
    if (depth === permissionsDepth && token.value === "http" && tokens[i + 1]?.value === ":") {
      if (tokens[i + 2]?.value !== "[") throw new Error("HTTP muss eine feste Liste sein.");
      let j = i + 3;
      for (; j < tokens.length && tokens[j].value !== "]"; j++) {
        if (tokens[j].kind === "string") http.push(tokens[j].value);
        else if (tokens[j].value !== ",")
          throw new Error("HTTP muss feste Zeichenfolgen enthalten.");
      }
    }
    if (token.kind === "punct" && ["{", "[", "("].includes(token.value)) depth++;
    if (token.kind === "punct" && ["}", "]", ")"].includes(token.value)) depth--;
    if (depth === permissionsDepth) permissionsEnd = true;
    if (permissionsEnd && depth < permissionsDepth) permissionsDepth = 0;
  }
  if (!id || (expectedId && id !== expectedId))
    throw new Error(`Plugin-ID "${id}" ungültig, erwartet "${expectedId ?? "feste ID"}".`);
  return { id, http };
}
