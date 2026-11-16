import { expect, test } from "bun:test";
import { resolveQueryRunTarget } from "../src/lib/query-run-target";
import { redisCommandMatches } from "../src/lib/redis-command-names";
import {
  canEditRedisCell,
  quoteRedisArgument,
  redisActionCommand,
  redisCellEditCommand,
  redisKeyFilter,
  redisOverwriteNotice,
  redisReadableValue,
  redisReadCommand,
} from "../src/lib/redis-commands";
import { splitSqlStatements, statementAtOffset } from "../src/lib/sql-statements";

test("Redis arguments preserve quotes, unicode and control characters without command injection", () => {
  expect(quoteRedisArgument('Grüße "Redis"\n\\\0')).toBe('"Grüße \\"Redis\\"\\x0a\\\\\\x00"');
  const command = redisActionCommand("string", "key\nFLUSHDB", '"\nDEL important', "");
  expect(command.split("\n")).toHaveLength(1);
  expect(command).toContain("KEEPTTL");
  expect(redisActionCommand("rename", "old", "existing", "")).toBe('RENAMENX "old" "existing"');
  expect(() => redisActionCommand("expire", "key", "-1", "")).toThrow();
  expect(() => redisActionCommand("expire", "key", "0", "")).toThrow();
  expect(() => redisActionCommand("zset", "key", "member", "Infinity")).toThrow();
  expect(redisActionCommand("hash", "key", "value", "field")).toBe('HSET "key" "field" "value"');
  expect(redisReadCommand("key", "stream")).toBe('XRANGE "key" - +');
});

test("Redis statements use lines, preserve semicolons and do not interpret SQL comments", () => {
  const text = '# Redis\nSET user:name "Ada; Lovelace"\r\nGET user:name\nSET --key value';
  const split = splitSqlStatements(text, "redis");
  expect(split.statements.map((statement) => statement.text)).toEqual([
    'SET user:name "Ada; Lovelace"',
    "GET user:name",
    "SET --key value",
  ]);
  const offset = text.indexOf("GET");
  expect(statementAtOffset(text, offset + 2, "redis")?.text).toBe("GET user:name");
  expect(resolveQueryRunTarget(text, "", offset, "selection-or-statement", "redis")).toBe(
    "GET user:name",
  );
});

test("Redis grid filters escape literal glob characters and never generate SQL", () => {
  expect(redisKeyFilter("key", "eq", "a*?[b]\\c")).toBe("a\\*\\?\\[b\\]\\\\c");
  expect(redisKeyFilter("key", "eq", " key LIKE test ")).toBe("[ ]key[ ]LIKE[ ]test[ ]");
  expect(redisKeyFilter("key", "contains", "user:")).toBe("*user:*");
  expect(redisKeyFilter("key", "startsWith", "user:")).toBe("user:*");
  expect(redisKeyFilter("key", "endsWith", "name")).toBe("*name");
  expect(redisKeyFilter("type", "eq", "hash")).toBeNull();
});

test("Redis cell edits preserve empty strings and reject unsafe preview replacements", () => {
  const row = { key: "key", type: "string", value: "old", ttl: null, size: 3, truncated: false };
  expect(redisCellEditCommand(row, { value: "" })).toContain('"old" ""');
  expect(redisCellEditCommand(row, { value: "old" })).toBeNull();
  expect(redisCellEditCommand(row, { ttl: "" })).toBe('PERSIST "key"');
  expect(redisCellEditCommand(row, { key: "new" })).toBe('RENAMENX "key" "new"');
  expect(() => redisCellEditCommand(row, { value: null })).toThrow();
  expect(() => redisCellEditCommand(row, { ttl: "-1" })).toThrow();
  expect(() => redisCellEditCommand({ ...row, truncated: true }, { value: "new" })).toThrow();
  expect(canEditRedisCell({ ...row, type: "hash" }, "value")).toBe(false);
  expect(canEditRedisCell({ ...row, value: "\\x00" }, "value")).toBe(false);
  expect(canEditRedisCell(row, "size")).toBe(false);
});

test("Redis string action refuses to replace other types until confirmed", () => {
  const guarded = redisActionCommand("string", "red:hash", "neu", "");
  expect(guarded.startsWith("EVAL ")).toBe(true);
  expect(guarded).toContain("TYPE");
  expect(guarded.split("\n")).toHaveLength(1);
  expect(redisActionCommand("string", "red:hash", "neu", "", true)).toBe(
    'SET "red:hash" "neu" KEEPTTL',
  );
  expect(redisOverwriteNotice("red:hash", ["hash", 3])).toBe(
    "red:hash ist ein Hash mit 3 Feldern. Überschreiben ersetzt ihn durch einen String.",
  );
  expect(redisOverwriteNotice("red:hash", "OK")).toBeNull();
});

test("Redis read results show hashes as objects and sorted sets as member/score pairs", () => {
  expect(redisReadableValue("hash", ["name", "Ada", "role", "admin"])).toEqual({
    name: "Ada",
    role: "admin",
  });
  expect(redisReadableValue("zset", ["ada", "10", "bo", "20.5"])).toEqual([
    { member: "ada", score: 10 },
    { member: "bo", score: 20.5 },
  ]);
  expect(redisReadableValue("zset", [["ada", 10]])).toEqual([{ member: "ada", score: 10 }]);
  expect(redisReadableValue("list", ["a", "b"])).toEqual(["a", "b"]);
});

test("Redis editor suggests command names only for the first word", () => {
  expect(redisCommandMatches("HGE")).toEqual(["HGET", "HGETALL"]);
  expect(redisCommandMatches("  zad")).toEqual(["ZADD"]);
  expect(redisCommandMatches("HGET HG")).toEqual([]);
  expect(redisCommandMatches("FLUSHA")).toEqual([]);
});
