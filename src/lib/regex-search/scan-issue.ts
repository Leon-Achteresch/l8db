import type { RegexCompileError } from "./types";

export function isQuantifierStart(char: string): boolean {
  return char === "*" || char === "+" || char === "?";
}

export function scanRegexIssue(pattern: string): RegexCompileError | null {
  const openGroups: number[] = [];
  let classStart = -1;
  let previousToken: "none" | "atom" | "quantifier" = "none";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];

    if (char === "\\") {
      if (index === pattern.length - 1) {
        return { message: "Offene Escape-Sequenz am Ende des Musters.", index };
      }
      index += 1;
      previousToken = "atom";
      continue;
    }

    if (classStart >= 0) {
      if (char === "]") {
        classStart = -1;
        previousToken = "atom";
      }
      continue;
    }

    if (char === "[") {
      classStart = index;
      continue;
    }

    if (char === "(") {
      openGroups.push(index);
      previousToken = "none";
      continue;
    }

    if (char === ")") {
      if (openGroups.length === 0) {
        return { message: "Schließende Klammer ohne passende öffnende Klammer.", index };
      }
      openGroups.pop();
      previousToken = "atom";
      continue;
    }

    if (char === "|") {
      previousToken = "none";
      continue;
    }

    if (isQuantifierStart(char)) {
      if (previousToken === "none") {
        return { message: "Quantifizierer ohne vorangehendes Zeichen.", index };
      }
      if (previousToken === "quantifier" && char !== "?") {
        return { message: "Mehrfacher Quantifizierer an derselben Stelle.", index };
      }
      previousToken = "quantifier";
      continue;
    }

    if (char === "{") {
      const close = pattern.indexOf("}", index);
      const body = close < 0 ? "" : pattern.slice(index + 1, close);
      const range = /^(\d+)(?:,(\d*))?$/.exec(body);
      if (close >= 0 && range) {
        if (previousToken === "none") {
          return { message: "Quantifizierer ohne vorangehendes Zeichen.", index };
        }
        const min = Number(range[1]);
        const max = range[2] === undefined || range[2] === "" ? null : Number(range[2]);
        if (max !== null && max < min) {
          return {
            message: "Ungültiger Wiederholungsbereich: Maximum kleiner als Minimum.",
            index,
          };
        }
        index = close;
        previousToken = "quantifier";
        continue;
      }
      previousToken = "atom";
      continue;
    }

    previousToken = "atom";
  }

  if (classStart >= 0) {
    return { message: "Zeichenklasse wurde nicht geschlossen.", index: classStart };
  }
  if (openGroups.length > 0) {
    return {
      message: "Gruppe wurde nicht geschlossen.",
      index: openGroups[openGroups.length - 1],
    };
  }
  return null;
}
