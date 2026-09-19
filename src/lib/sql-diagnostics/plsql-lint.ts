import { lineEnd, lineStart, type SqlMarker } from "./markers";
import { type Block, type BlockKind, type BlockPair, type Token, tokenize } from "./plsql-tokenize";

const OPENER_HINT: Record<BlockKind, string> = {
  BEGIN: "BEGIN ohne passendes END",
  DECLARE: "DECLARE ohne BEGIN … END",
  SUBPROGRAM: "Unterprogramm ohne BEGIN … END",
  PACKAGE: "Package ohne abschließendes END",
  COMPOUND: "Compound Trigger ohne abschließendes END",
  IF: "IF ohne END IF",
  LOOP: "LOOP ohne END LOOP",
  CASE: "CASE ohne END",
};

export function lintPlsql(src: string): SqlMarker[] {
  return analyzePlsql(src).findings;
}

export function plsqlBlockPairs(src: string): BlockPair[] {
  return analyzePlsql(src).pairs;
}

function analyzePlsql(src: string): { findings: SqlMarker[]; pairs: BlockPair[] } {
  const findings: SqlMarker[] = [];
  const pairs: BlockPair[] = [];
  const tokens = tokenize(src, findings);
  const blocks: Block[] = [];
  const parens: Token[] = [];
  let pendingHeader: "SUBPROGRAM" | "PACKAGE" | null = null;
  let headerDepth = 0;
  let inSet = false;

  const add = (token: Token, message: string, severity: SqlMarker["severity"] = "error") =>
    findings.push({ start: token.start, end: token.end, message, severity });
  const unclosed = (from: number) => {
    for (const block of blocks.splice(from)) add(block.token, OPENER_HINT[block.kind]);
  };
  const flushParens = () => {
    for (const paren of parens.splice(0)) add(paren, "Klammer wird nicht geschlossen");
  };
  const findBlock = (kinds: BlockKind[]) => {
    for (let i = blocks.length - 1; i >= 0; i--) if (kinds.includes(blocks[i].kind)) return i;
    return -1;
  };
  const expectSemicolon = (token: Token, index: number, label: string) => {
    let next = tokens[index];
    if (
      next &&
      /^[A-Z_$"]/.test(next.upper) &&
      !["END", "BEGIN", "IF", "LOOP"].includes(next.upper)
    ) {
      next = tokens[index + 1];
    }
    if (next?.upper !== ";") add(token, `Semikolon nach ${label} fehlt`);
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const prev = tokens[i - 1]?.upper;
    const next = tokens[i + 1]?.upper;
    const isSlashLine =
      token.upper === "/" &&
      src.slice(lineStart(src, token.start), token.start).trim() === "" &&
      src.slice(token.end, lineEnd(src, token.end)).trim() === "";
    if (isSlashLine) {
      unclosed(0);
      flushParens();
      pendingHeader = null;
      inSet = false;
      continue;
    }
    switch (token.upper) {
      case "(":
        parens.push(token);
        break;
      case ")":
        if (!parens.pop()) add(token, "Schließende Klammer ohne öffnende Klammer");
        break;
      case ";":
        flushParens();
        pendingHeader = null;
        inSet = false;
        break;
      case "SET":
        inSet = true;
        break;
      case "WHERE":
        inSet = false;
        break;
      case "PROCEDURE":
      case "FUNCTION":
        if (prev !== "END") {
          pendingHeader = "SUBPROGRAM";
          headerDepth = parens.length;
        }
        break;
      case "PACKAGE":
        pendingHeader = "PACKAGE";
        headerDepth = parens.length;
        break;
      case "TYPE":
        if (next === "BODY") {
          pendingHeader = "PACKAGE";
          headerDepth = parens.length;
        }
        break;
      case "IS":
      case "AS":
        if (pendingHeader && parens.length === headerDepth) {
          if (next !== "LANGUAGE" && next !== "EXTERNAL") {
            blocks.push({ kind: pendingHeader, token });
          }
          pendingHeader = null;
        } else if (
          token.upper === "IS" &&
          (prev === "ROW" || prev === "STATEMENT") &&
          blocks.at(-1)?.kind === "COMPOUND"
        ) {
          blocks.push({ kind: "SUBPROGRAM", token });
        }
        break;
      case "COMPOUND":
        if (next === "TRIGGER") blocks.push({ kind: "COMPOUND", token });
        break;
      case "DECLARE":
        blocks.push({ kind: "DECLARE", token });
        break;
      case "BEGIN": {
        const top = blocks.at(-1);
        if (
          top &&
          (top.kind === "DECLARE" || top.kind === "SUBPROGRAM" || top.kind === "PACKAGE")
        ) {
          blocks[blocks.length - 1] = { kind: "BEGIN", token };
        } else blocks.push({ kind: "BEGIN", token });
        break;
      }
      case "IF":
        if (next === "EXISTS" || (next === "NOT" && tokens[i + 2]?.upper === "EXISTS")) break;
        if (prev === "ELSE")
          add(
            token,
            "ELSE IF öffnet ein neues IF (braucht eigenes END IF) – ELSIF gemeint?",
            "warning",
          );
        blocks.push({ kind: "IF", token });
        break;
      case "ELSEIF":
        add(token, "ELSEIF gibt es in PL/SQL nicht – ELSIF verwenden");
        break;
      case "LOOP":
      case "CASE":
        blocks.push({ kind: token.upper as BlockKind, token });
        break;
      case "END": {
        if (next === "IF" || next === "LOOP" || next === "CASE") {
          const index = findBlock([next]);
          if (index < 0) add(token, `END ${next} ohne passendes ${next}`);
          else {
            unclosed(index + 1);
            const block = blocks.pop() as Block;
            pairs.push({
              open: block.token,
              close: { start: token.start, end: tokens[i + 1].end },
            });
          }
          expectSemicolon(token, i + 2, `END ${next}`);
          i++;
          break;
        }
        const index = findBlock(["BEGIN", "DECLARE", "SUBPROGRAM", "PACKAGE", "COMPOUND", "CASE"]);
        if (index < 0) {
          add(token, "END ohne passenden Blockanfang");
          break;
        }
        unclosed(index + 1);
        const block = blocks.pop() as Block;
        pairs.push({ open: block.token, close: token });
        if (block.kind === "CASE") break;
        if (next === "BEFORE" || next === "AFTER" || next === "INSTEAD") break;
        expectSemicolon(token, i + 1, "END");
        break;
      }
      case "OTHERS":
        if (
          prev === "WHEN" &&
          next === "THEN" &&
          tokens[i + 2]?.upper === "NULL" &&
          tokens[i + 3]?.upper === ";"
        ) {
          add(tokens[i + 2], "WHEN OTHERS THEN NULL verschluckt alle Fehler", "warning");
        }
        break;
      case "NULL":
        if (
          prev === "<>" ||
          prev === "!=" ||
          prev === "^=" ||
          prev === "~=" ||
          (prev === "=" && !inSet)
        ) {
          add(
            tokens[i - 1],
            `Vergleich "${prev} NULL" ist nie wahr – IS ${prev === "=" ? "" : "NOT "}NULL verwenden`,
            "warning",
          );
        }
        break;
    }
  }
  unclosed(0);
  flushParens();
  return { findings: findings.sort((a, b) => a.start - b.start), pairs };
}
