import { type Node, parse } from "acorn";

import { GUARD_NAME } from "./execution-guard";

type Tree = Node & {
  body?: Tree;
  expression?: boolean;
  regex?: { pattern: string };
  name?: string;
  callee?: Tree;
  arguments?: Tree[];
  value?: unknown;
  property?: Tree;
  object?: Tree;
  argument?: Tree;
  generator?: boolean;
  await?: boolean;
};

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const LOOPS = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
]);

const INVOKES = new Set([
  "CallExpression",
  "NewExpression",
  "TaggedTemplateExpression",
  "AwaitExpression",
]);

function invokes(node: Tree): boolean {
  if (INVOKES.has(node.type)) return true;
  for (const value of Object.values(node)) {
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (const item of value)
        if (item && typeof item.type === "string" && invokes(item)) return true;
    } else if ("type" in value && invokes(value as Tree)) return true;
  }
  return false;
}

function checkPattern(pattern: string) {
  let escaped = false;
  let characterClass = false;
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") escaped = true;
    else if (char === "[") characterClass = true;
    else if (char === "]") characterClass = false;
    else if (!characterClass && char === ")" && /[+*?{]/.test(pattern[index + 1] ?? ""))
      throw new Error("Quantifizierte Regex-Gruppen sind in UI-Plugins nicht erlaubt.");
  }
}

export function instrumentPlugin(code: string): string {
  const arrows: number[] = [];
  const tree = parse(code, {
    ecmaVersion: "latest",
    sourceType: "script",
    onToken: (token) => {
      if (token.type.label === "=>") arrows.push(token.end);
    },
  }) as unknown as Tree;
  const edits: { at: number; text: string; close: boolean; depth: number }[] = [];
  let level = 0;
  const insert = (at: number, text: string, close = false) =>
    edits.push({ at, text, close, depth: level });
  function visit(node: Tree) {
    level++;
    if (
      (node.type === "CallExpression" || node.type === "NewExpression") &&
      node.arguments?.length
    ) {
      const callee = node.callee;
      if (
        callee?.name === "Array" ||
        (callee?.type === "MemberExpression" &&
          (callee.property?.name === "repeat" || callee.property?.value === "repeat"))
      ) {
        const argument = node.arguments[0];
        if (argument.type === "SpreadElement")
          throw new Error("Dynamische Allokationsargumente sind nicht erlaubt.");
        insert(argument.start, `${GUARD_NAME}.size(`);
        insert(argument.end, ")", true);
      }
    }
    if (node.generator) throw new Error("Generatorfunktionen sind in UI-Plugins nicht erlaubt.");
    if (node.type === "ForOfStatement" && node.await)
      throw new Error("for await ist in UI-Plugins nicht erlaubt.");
    if (node.type === "AwaitExpression" && node.argument) {
      insert(node.argument.start, `${GUARD_NAME}.suspend(`);
      insert(node.argument.end, ")", true);
    }
    if (node.regex) checkPattern(node.regex.pattern);
    if (
      (node.type === "CallExpression" || node.type === "NewExpression") &&
      node.callee?.name === "RegExp"
    ) {
      const pattern = node.arguments?.[0]?.value;
      if (typeof pattern !== "string") throw new Error("RegExp benötigt ein literales Muster.");
      checkPattern(pattern);
    }
    if (FUNCTIONS.has(node.type) && node.body) {
      const body = node.body;
      if (body.type === "BlockStatement") {
        insert(body.start + 1, `${GUARD_NAME}.enter();try{`);
        insert(body.end - 1, `}finally{${GUARD_NAME}.leave();}`, true);
      } else if (invokes(body)) {
        let low = 0;
        let high = arrows.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (arrows[mid] <= body.start) low = mid + 1;
          else high = mid;
        }
        if (!low) throw new Error("Pfeilfunktion konnte nicht abgesichert werden.");
        insert(arrows[low - 1], `{${GUARD_NAME}.enter();try{return (`);
        insert(node.end, `);}finally{${GUARD_NAME}.leave();}}`, true);
      }
    }
    if (LOOPS.has(node.type) && node.body) {
      const body = node.body;
      if (body.type === "BlockStatement") insert(body.start + 1, `${GUARD_NAME}.check();`);
      else {
        insert(body.start, `{${GUARD_NAME}.check();`);
        insert(body.end, "}", true);
      }
    }
    for (const value of Object.values(node)) {
      if (!value || typeof value !== "object") continue;
      if (Array.isArray(value)) {
        for (const item of value) if (item && typeof item.type === "string") visit(item);
      } else if (value && typeof value === "object" && "type" in value) visit(value as Tree);
    }
    level--;
  }
  visit(tree);
  edits.sort(
    (a, b) =>
      a.at - b.at ||
      Number(b.close) - Number(a.close) ||
      (a.close ? b.depth - a.depth : a.depth - b.depth),
  );
  const parts: string[] = [];
  let cursor = 0;
  for (const edit of edits) {
    parts.push(code.slice(cursor, edit.at), edit.text);
    cursor = edit.at;
  }
  parts.push(code.slice(cursor));
  return parts.join("");
}
