import { mkdir } from "node:fs/promises";
import type { Browser } from "playwright";

export async function saveBrowserArtifacts(browser: Browser, suite: string) {
  const directory = "test-artifacts/browser";
  await mkdir(directory, { recursive: true });
  for (const [index, page] of browser
    .contexts()
    .flatMap((context) => context.pages())
    .entries()) {
    if (page.isClosed()) continue;
    await page
      .screenshot({
        path: `${directory}/${suite}-${browser.browserType().name()}-${index}.png`,
        timeout: 5000,
      })
      .catch(() => undefined);
  }
}
