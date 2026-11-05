import { PLUGIN_GLOBALS } from "./globals";

const ERROR_CONSTRUCTORS = [
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
  "AggregateError",
];

const OVERRIDABLE_OBJECT = [
  "constructor",
  "toString",
  "toLocaleString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
];

const OVERRIDABLE_ERROR = ["constructor", "message", "name", "toString"];

const OVERRIDABLE_FUNCTION = ["constructor", "toString", "bind"];

let locked = false;

function functionPrototypes(): object[] {
  return [
    Function.prototype,
    Object.getPrototypeOf(async () => undefined),
    Object.getPrototypeOf(function* () {}),
    Object.getPrototypeOf(async function* () {}),
  ];
}

function tameConstructor(prototype: object) {
  const original = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
  const tamed = () => {
    throw new TypeError("Code aus Text zu erzeugen ist nicht erlaubt.");
  };
  Object.defineProperty(tamed, "name", { value: original?.name ?? "Function" });
  Object.defineProperty(tamed, "prototype", { value: prototype, writable: false });
  Object.defineProperty(prototype, "constructor", {
    value: tamed,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

function allowOverride(target: object, key: PropertyKey) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor || !("value" in descriptor) || !descriptor.configurable) return;
  const value = descriptor.value;
  Object.defineProperty(target, key, {
    get() {
      return value;
    },
    set(this: unknown, next: unknown) {
      if (
        this === target ||
        this === null ||
        (typeof this !== "object" && typeof this !== "function")
      )
        return;
      Object.defineProperty(this, key, {
        value: next,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    },
    enumerable: descriptor.enumerable,
    configurable: false,
  });
}

function hiddenIntrinsics(): unknown[] {
  const iterator = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]()));
  const scope = globalThis as { Iterator?: { from?: (value: unknown) => unknown } };
  const list: unknown[] = [
    ...functionPrototypes(),
    iterator,
    Object.getPrototypeOf([][Symbol.iterator]()),
    Object.getPrototypeOf(new Map()[Symbol.iterator]()),
    Object.getPrototypeOf(new Set()[Symbol.iterator]()),
    Object.getPrototypeOf(""[Symbol.iterator]()),
    Object.getPrototypeOf("".matchAll(/x/g)),
    Object.getPrototypeOf(Uint8Array),
    scope.Iterator,
  ];
  if (typeof iterator.map === "function")
    list.push(Object.getPrototypeOf(iterator.map.call([].values(), (value: unknown) => value)));
  if (typeof scope.Iterator?.from === "function")
    list.push(Object.getPrototypeOf(scope.Iterator.from({ next: () => ({ done: true }) })));
  if (typeof Intl.Segmenter === "function") {
    const segments = new Intl.Segmenter().segment("");
    list.push(Object.getPrototypeOf(segments), Object.getPrototypeOf(segments[Symbol.iterator]()));
  }
  return list;
}

function freeze(target: object) {
  if (target !== Error) {
    Object.freeze(target);
    return;
  }
  Object.preventExtensions(target);
  for (const key of Reflect.ownKeys(target)) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor?.configurable) continue;
    Object.defineProperty(
      target,
      key,
      "value" in descriptor && key !== "stackTraceLimit"
        ? { configurable: false, writable: false }
        : { configurable: false },
    );
  }
}

function harden(roots: unknown[]) {
  const seen = new Set<object>();
  const stack = [...roots];
  while (stack.length) {
    const value = stack.pop();
    if (value === null || (typeof value !== "object" && typeof value !== "function")) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    stack.push(Object.getPrototypeOf(value));
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) continue;
      if ("value" in descriptor) stack.push(descriptor.value);
      else stack.push(descriptor.get, descriptor.set);
    }
    freeze(value);
  }
}

export function lockdownRealm() {
  if (locked) return;
  locked = true;
  const scope = globalThis as Record<string, unknown>;
  for (const prototype of functionPrototypes()) tameConstructor(prototype);
  for (const key of OVERRIDABLE_OBJECT) allowOverride(Object.prototype, key);
  for (const key of OVERRIDABLE_FUNCTION) allowOverride(Function.prototype, key);
  for (const name of ERROR_CONSTRUCTORS) {
    const prototype = (scope[name] as { prototype?: object } | undefined)?.prototype;
    if (prototype) for (const key of OVERRIDABLE_ERROR) allowOverride(prototype, key);
  }
  harden([...PLUGIN_GLOBALS.map((name) => scope[name]), ...hiddenIntrinsics()]);
}
