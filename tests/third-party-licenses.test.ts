import { expect, test } from "bun:test";
import { licenseSections } from "../src/lib/third-party-licenses";

const bar = "=".repeat(80);
const text = `Header\n\n${bar}\nLicense: MIT\n\nreact 19.0.0 (npm)\n\nMIT text\n\n${bar}\nLicense: Apache-2.0\n\nserde 1.0.0 (Rust)\n\nApache text\n`;

test("splits notices into header and license groups", () => {
  const sections = licenseSections(text, "");
  expect(sections).toHaveLength(3);
  expect(sections[0]).toBe("Header");
  expect(sections[2]).toStartWith(`${bar}\nLicense: Apache-2.0`);
});

test("filters groups by package or license and drops the header", () => {
  expect(licenseSections(text, "SERDE")).toEqual([
    `${bar}\nLicense: Apache-2.0\n\nserde 1.0.0 (Rust)\n\nApache text\n`,
  ]);
  expect(licenseSections(text, "nothing")).toEqual([]);
  expect(licenseSections("", "")).toEqual([]);
});
