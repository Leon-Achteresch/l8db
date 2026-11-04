import { expect, test } from "bun:test";
import { appwriteHasMore, appwriteTotal } from "@/lib/appwrite-paging";

const page = (count: number, total: number) => ({ items: Array(count).fill(0), total });

test("Appwrite paging continues past the 5000 count cap", () => {
  expect(appwriteHasMore(4900, page(100, 5000))).toBe(true);
  expect(appwriteHasMore(5000, page(100, 5000))).toBe(true);
  expect(appwriteHasMore(5100, page(40, 5000))).toBe(false);
  expect(appwriteHasMore(0, page(30, 30))).toBe(false);
  expect(appwriteTotal(page(100, 5000))).toBe("≥ 5000");
  expect(appwriteTotal(page(30, 30))).toBe("30");
});
