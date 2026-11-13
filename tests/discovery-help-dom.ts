export interface FakeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FakeNode {
  tagName: string;
  attrs: Record<string, string>;
  classes: string[];
  children: FakeNode[];
  parentElement: FakeNode | null;
  textContent: string;
  rect: FakeRect;
  isConnected: boolean;
  getAttribute(name: string): string | null;
  getBoundingClientRect(): DOMRect;
  closest(selector: string): FakeNode | null;
  matches(selector: string): boolean;
  querySelector(selector: string): FakeNode | null;
  querySelectorAll(selector: string): FakeNode[];
}

function matchesSimple(node: FakeNode, selector: string): boolean {
  const match = /^([a-z0-9]*)((?:\[[^\]]+\]|\.[\w-]+)*)$/i.exec(selector.trim());
  if (!match) return false;
  if (match[1] && node.tagName.toLowerCase() !== match[1].toLowerCase()) return false;
  for (const part of match[2].match(/\[[^\]]+\]|\.[\w-]+/g) ?? []) {
    if (part.startsWith(".")) {
      if (!node.classes.includes(part.slice(1))) return false;
      continue;
    }
    const attr = /^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(part);
    if (!attr) return false;
    const value = node.attrs[attr[1]];
    if (value === undefined) return false;
    if (attr[2] !== undefined && value !== attr[2]) return false;
  }
  return true;
}

function matchesList(node: FakeNode, selector: string): boolean {
  return selector.split(",").some((part) => matchesSimple(node, part));
}

function* descendants(node: FakeNode): Generator<FakeNode> {
  for (const child of node.children) {
    yield child;
    yield* descendants(child);
  }
}

export function el(
  tag: string,
  attrs: Record<string, string> = {},
  children: FakeNode[] = [],
  options: { rect?: FakeRect; text?: string; classes?: string[] } = {},
): FakeNode {
  const node: FakeNode = {
    tagName: tag.toUpperCase(),
    attrs,
    classes: options.classes ?? [],
    children,
    parentElement: null,
    textContent: options.text ?? children.map((child) => child.textContent).join(""),
    rect: options.rect ?? { left: 10, top: 10, width: 40, height: 20 },
    isConnected: true,
    getAttribute: (name) => node.attrs[name] ?? null,
    getBoundingClientRect: () =>
      ({
        ...node.rect,
        right: node.rect.left + node.rect.width,
        bottom: node.rect.top + node.rect.height,
      }) as DOMRect,
    closest: (selector) => {
      for (let current: FakeNode | null = node; current; current = current.parentElement)
        if (matchesList(current, selector)) return current;
      return null;
    },
    matches: (selector) => matchesList(node, selector),
    querySelector: (selector) => {
      for (const child of descendants(node)) if (matchesList(child, selector)) return child;
      return null;
    },
    querySelectorAll: (selector) =>
      [...descendants(node)].filter((child) => matchesList(child, selector)),
  };
  for (const child of children) child.parentElement = node;
  return node;
}

export function keyEvent(
  key: string,
  modifiers: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {},
  code = "",
) {
  return {
    key,
    code,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    getModifierState: () => false,
    ...modifiers,
  } as unknown as KeyboardEvent;
}

export function fakeTarget() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    listeners,
    count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    emit: (type: string, event: unknown = {}) => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.get(type)?.delete(listener);
    },
    hidden: false,
  };
}
