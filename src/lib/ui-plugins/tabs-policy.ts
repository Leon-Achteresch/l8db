import { useConnectionsStore } from "@/lib/connections";
import { type Tab, tabKey, useTableTabs } from "@/lib/table-tabs";
import { storeFor } from "@/lib/table-tabs/helpers";
import { uiPluginRegistry } from "./store";
import { tabInfo } from "./tab-info";

const history: string[] = [];

export function noteActiveTab(key: string) {
  const at = history.indexOf(key);
  if (at !== -1) history.splice(at, 1);
  history.unshift(key);
  history.length = Math.min(history.length, 50);
}

export function arrangeNewTabs(
  previous: readonly Tab[],
  next: readonly Tab[],
  policy: {
    position: "end" | "afterActive";
    group: ((tab: Tab) => string | undefined) | null;
    anchor: readonly string[];
  },
): Tab[] | null {
  if (next.length <= previous.length) return null;
  for (let index = 0; index < previous.length; index++)
    if (tabKey(previous[index]) !== tabKey(next[index])) return null;
  const added = next.slice(previous.length);
  const result = [...previous];
  const groupOf = (tab: Tab) => policy.group?.(tab);
  const groups = result.map(groupOf);
  const anchorKey = policy.anchor.find((key) => previous.some((tab) => tabKey(tab) === key));
  let cursor = anchorKey ? result.findIndex((tab) => tabKey(tab) === anchorKey) : -1;
  for (const tab of added) {
    const group = groupOf(tab);
    const member = group === undefined ? -1 : groups.lastIndexOf(group);
    const afterActive = member === -1 && policy.position === "afterActive" && cursor !== -1;
    const at = member !== -1 ? member : afterActive ? cursor : result.length - 1;
    result.splice(at + 1, 0, tab);
    groups.splice(at + 1, 0, group);
    if (afterActive) cursor = at + 1;
    else if (cursor > at) cursor++;
  }
  return result.every((tab, index) => tab === next[index]) ? null : result;
}

let started = false;

export function startTabPolicy() {
  if (started) return;
  started = true;
  let connection = useConnectionsStore.getState().activeId;
  useTableTabs.subscribe((state, previous) => {
    const { activeId, connections } = useConnectionsStore.getState();
    if (activeId !== connection) {
      connection = activeId;
      return;
    }
    if (state.tabs === previous.tabs) return;
    const registry = uiPluginRegistry();
    const tabGroup = registry.tabGroup;
    if (registry.newTabPosition === "end" && !tabGroup) return;
    const active = connections.find((entry) => entry.id === activeId);
    const arranged = arrangeNewTabs(previous.tabs, state.tabs, {
      position: registry.newTabPosition,
      group: tabGroup
        ? (tab) =>
            tabGroup(
              tabInfo(
                tab,
                tab.connectionId
                  ? connections.find((entry) => entry.id === tab.connectionId)
                  : active,
              ),
            )?.id
        : null,
      anchor: history,
    });
    if (arranged) useTableTabs.setState((current) => storeFor(arranged, current));
  });
}
