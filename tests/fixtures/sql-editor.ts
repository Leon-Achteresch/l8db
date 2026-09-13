import type { Locator, Page } from "playwright";

export async function replaceSql(page: Page, editor: Locator, sql: string): Promise<void> {
  await editor.locator(".native-edit-context, textarea.inputarea").first().focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(sql);
}
