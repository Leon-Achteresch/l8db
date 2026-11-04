import type { Locator, Page } from "playwright";

export async function seedSplitDndVideo(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      "l8db.table-tabs",
      JSON.stringify({
        version: 4,
        state: {
          tabsByConnection: {
            perf: ["table_0000", "table_0001", "table_0002", "table_0003"].map((table) => ({
              kind: "table",
              schema: "public",
              table,
            })),
          },
        },
      }),
    );
    addEventListener("DOMContentLoaded", () => {
      const cursor = document.createElement("div");
      cursor.id = "demo-cursor";
      cursor.style.cssText =
        "position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:#ffffffd9;border:2px solid #2563eb;box-shadow:0 2px 10px #0009;z-index:20000001;pointer-events:none;transition:transform .12s,background .12s;transform:translate(-100px,-100px)";
      document.documentElement.append(cursor);
      let x = -100;
      let y = -100;
      let pressed = false;
      const paint = () => {
        cursor.style.transform = `translate(${x}px, ${y}px) scale(${pressed ? 0.75 : 1})`;
        cursor.style.background = pressed ? "#2563ebd9" : "#ffffffd9";
      };
      addEventListener(
        "pointermove",
        (event) => {
          x = event.clientX;
          y = event.clientY;
          paint();
        },
        true,
      );
      addEventListener(
        "pointerdown",
        () => {
          pressed = true;
          paint();
        },
        true,
      );
      addEventListener(
        "pointerup",
        () => {
          pressed = false;
          paint();
        },
        true,
      );
    });
  });
}

export async function dragTo(
  page: Page,
  from: Locator,
  to: { x: number; y: number },
  hold = 1100,
): Promise<void> {
  const box = await from.boundingBox();
  if (!box) throw new Error("Ziehquelle fehlt");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y, { steps: 18 });
  await page.waitForTimeout(350);
  await page.mouse.down();
  await page.mouse.move(start.x + 12, start.y + 6, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 40 });
  await page.waitForTimeout(hold);
  await page.mouse.up();
}

export async function inside(target: Locator, fx: number, fy: number) {
  const box = await target.boundingBox();
  if (!box) throw new Error("Ablageziel fehlt");
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}
