import { expect, test } from "bun:test";
import { BINARY_UTF8_MAX_BYTES, decodeBinaryUtf8 } from "../src/lib/value-viewers/binary";

test("a full-size UTF-8 view and a larger rejected value have bounded decoding work", () => {
  const line = new TextEncoder().encode("Grüße 東京 🧪\n");
  const input = new Uint8Array(BINARY_UTF8_MAX_BYTES).fill(0x61);
  for (let offset = 0; offset + line.length <= input.length; offset += line.length)
    input.set(line, offset);
  const oversized = new Uint8Array(16 * 1024 * 1024).fill(0xff);
  const decodeTimes: number[] = [];
  const rejectTimes: number[] = [];
  for (let run = 0; run < 13; run++) {
    let preview = decodeBinaryUtf8(input);
    const decodeStart = performance.now();
    for (let i = 0; i < 32; i++) preview = decodeBinaryUtf8(input);
    const decodeTime = performance.now() - decodeStart;
    if (preview.state !== "text") throw Error("Expected a full-size text preview");
    expect(preview.text.length).toBeLessThanOrEqual(input.length);
    let rejected = decodeBinaryUtf8(oversized);
    const rejectStart = performance.now();
    for (let i = 0; i < 2_000; i++) rejected = decodeBinaryUtf8(oversized);
    const rejectTime = performance.now() - rejectStart;
    expect(rejected.state).toBe("too-large");
    if (run >= 2) {
      decodeTimes.push(decodeTime);
      rejectTimes.push(rejectTime);
    }
  }
  decodeTimes.sort((a, b) => a - b);
  rejectTimes.sort((a, b) => a - b);
  console.log(
    `A29 decoder: 32 x ${input.length} bytes median=${decodeTimes[5].toFixed(3)}ms p95=${decodeTimes[10].toFixed(3)}ms; 2000 x ${oversized.length} bytes rejected median=${rejectTimes[5].toFixed(3)}ms p95=${rejectTimes[10].toFixed(3)}ms`,
  );
  expect(decodeTimes[5]).toBeLessThan(60);
  expect(decodeTimes[10]).toBeLessThan(125);
  expect(rejectTimes[10]).toBeLessThan(15);
});
