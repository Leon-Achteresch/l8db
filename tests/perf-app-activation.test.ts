import { expect, test } from "bun:test";
import { arch, cpus, platform, totalmem } from "node:os";
import { chromium } from "playwright";

const url = process.env.L8DB_APP_DESIGN_BROWSER_URL;

test.skipIf(!url)(
  "activation stays immediate and idle with 3000 database tables behind the overlay",
  async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
      await page.goto(`${url}/tests/fixtures/app-activation.html?tables=3000`);
      await page.getByRole("button", { name: "Neue SQL-Abfrage", exact: true }).waitFor();
      await page.waitForFunction(() => document.body.innerText.includes("table_0000"));
      const samples = await page.evaluate(async () => {
        const setDone = (done: boolean) => {
          const stored = JSON.parse(localStorage.getItem("l8db.settings") ?? "{}");
          stored.state.onboardingDone = done;
          const newValue = JSON.stringify(stored);
          localStorage.setItem("l8db.settings", newValue);
          window.dispatchEvent(
            new StorageEvent("storage", {
              key: "l8db.settings",
              newValue,
              storageArea: localStorage,
            }),
          );
        };
        const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const wait = async (predicate: () => boolean) => {
          const deadline = performance.now() + 2000;
          while (!predicate()) {
            if (performance.now() > deadline) throw new Error("Activation did not settle");
            await frame();
          }
        };
        const durations: number[] = [];
        const overlayNodes: number[] = [];
        for (let index = 0; index < 11; index++) {
          const start = performance.now();
          setDone(false);
          await wait(() => Boolean(document.querySelector(".onboarding-welcome")));
          document.querySelector(".onboarding-welcome")?.getBoundingClientRect();
          if (index > 1) durations.push(performance.now() - start);
          overlayNodes.push(document.querySelectorAll(".onboarding-welcome *").length);
          setDone(true);
          await wait(() => !document.querySelector("[data-onboarding]"));
        }
        durations.sort((a, b) => a - b);
        setDone(false);
        await wait(() => Boolean(document.querySelector(".onboarding-welcome")));
        const intro = document.querySelector(".onboarding-welcome");
        if (!intro) throw new Error("Missing onboarding intro");
        return {
          medianMs: durations[4],
          p95Ms: durations[8],
          maxIntroNodes: Math.max(...overlayNodes),
          introAnimations: intro.getAnimations({ subtree: true }).length,
          nodesBeforeLeave: document.querySelectorAll("*").length,
        };
      });
      expect(samples.p95Ms).toBeLessThan(120);
      expect(samples.maxIntroNodes).toBeLessThan(120);
      const beforeIdle = await page.evaluate(() => ({
        ...(window as unknown as { appDesignMetrics: { commands: Record<string, number> } })
          .appDesignMetrics.commands,
      }));
      await page.waitForTimeout(1500);
      const afterIdle = await page.evaluate(() => ({
        ...(window as unknown as { appDesignMetrics: { commands: Record<string, number> } })
          .appDesignMetrics.commands,
      }));
      const idleAnimations = await page
        .locator(".onboarding-welcome")
        .evaluate((node) => node.getAnimations({ subtree: true }).length);
      expect(idleAnimations).toBe(0);
      const databaseCommands = (commands: Record<string, number>) =>
        Object.entries(commands).filter(([command]) =>
          /^(list_tables|list_schemas|list_databases|list_views|list_functions|fetch_table_rows|count_table_rows|get_database_overview|execute_query)$/.test(
            command,
          ),
        );
      expect(databaseCommands(afterIdle)).toEqual(databaseCommands(beforeIdle));
      await page.getByRole("button", { name: "Direkt loslegen", exact: true }).click();
      await page.locator("[data-onboarding]").waitFor({ state: "hidden" });
      const retained = await page.evaluate(() => ({
        introNodes: document.querySelectorAll(".onboarding-welcome").length,
        animations: document.getAnimations().filter((animation) => {
          const target = (animation.effect as KeyframeEffect | null)?.target;
          return target instanceof Element && Boolean(target.closest("[data-onboarding]"));
        }).length,
        active: document.body.hasAttribute("data-onboarding-active"),
        nodes: document.querySelectorAll("*").length,
      }));
      expect(retained.introNodes).toBe(0);
      expect(retained.animations).toBe(0);
      expect(retained.active).toBe(false);
      expect(retained.nodes).toBeLessThan(1600);
      console.log(
        JSON.stringify({
          scenario: "app-activation",
          platform: platform(),
          arch: arch(),
          cpu: cpus()[0]?.model,
          logicalCpus: cpus().length,
          ramGiB: totalmem() / 2 ** 30,
          runtime: Bun.version,
          browser: browser.version(),
          cpuRate: 1,
          tables: 3000,
          samples: 9,
          ...samples,
          retained,
          idleDatabaseRequests: 0,
          idleAnimations,
          commands: databaseCommands(afterIdle),
        }),
      );
    } finally {
      await browser.close();
    }
  },
  60000,
);
