import { expect, test } from "bun:test";
import {
  effectiveSidebarWidth,
  migrateSidebarPanel,
  SIDEBAR_PANEL_DEFAULT_WIDTH,
  SIDEBAR_PANEL_NAV_EXPANDED_WIDTH,
  useSidebarPanel,
} from "../src/lib/sidebar-panel";

test("a dragged default width is kept when the nav rail is expanded", () => {
  expect(effectiveSidebarWidth(null, true)).toBe(SIDEBAR_PANEL_NAV_EXPANDED_WIDTH);
  expect(effectiveSidebarWidth(null, false)).toBe(SIDEBAR_PANEL_DEFAULT_WIDTH);
  useSidebarPanel.getState().setWidth(SIDEBAR_PANEL_DEFAULT_WIDTH);
  expect(effectiveSidebarWidth(useSidebarPanel.getState().width, true)).toBe(
    SIDEBAR_PANEL_DEFAULT_WIDTH,
  );
});

test("legacy persisted widths migrate without losing custom values", () => {
  expect(migrateSidebarPanel({ width: SIDEBAR_PANEL_DEFAULT_WIDTH }, 0)).toEqual({ width: null });
  expect(migrateSidebarPanel({ width: 400 }, 0)).toEqual({ width: 400 });
  expect(migrateSidebarPanel({ width: SIDEBAR_PANEL_DEFAULT_WIDTH }, 1)).toEqual({
    width: SIDEBAR_PANEL_DEFAULT_WIDTH,
  });
});
