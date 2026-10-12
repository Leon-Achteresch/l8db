import { createContext, useContext, useSyncExternalStore } from "react";

export const PortalContainerContext = createContext<HTMLElement | undefined>(undefined);

const containers: { container: HTMLElement; owner: symbol }[] = [];
const listeners = new Set<() => void>();

function currentContainer() {
  return containers.at(-1)?.container;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const emptyContainer = () => undefined;
const subscribeToNothing = () => () => {};

function publish() {
  for (const listener of listeners) listener();
}

export function registerPortalContainer(container: HTMLElement) {
  const owner = Symbol();
  const previous = currentContainer();
  containers.push({ container, owner });
  if (currentContainer() !== previous) publish();
  return () => {
    const index = containers.findIndex((entry) => entry.owner === owner);
    if (index < 0) return;
    const previous = currentContainer();
    containers.splice(index, 1);
    if (currentContainer() !== previous) publish();
  };
}

export function usePortalContainer() {
  return useContext(PortalContainerContext);
}

export function useActivePortalContainer() {
  const scopedContainer = usePortalContainer();
  const activeContainer = useSyncExternalStore(
    scopedContainer ? subscribeToNothing : subscribe,
    scopedContainer ? emptyContainer : currentContainer,
    emptyContainer,
  );
  return scopedContainer ?? activeContainer;
}
