import {
  createRow,
  type Row,
  type RowData,
  type RowModel,
  type Table,
} from "@tanstack/react-table";

export function getVirtualRowModel<T extends RowData>(cacheSize = 512) {
  return (table: Table<T>): (() => RowModel<T>) => {
    let source: T[] | undefined;
    let model: RowModel<T>;
    return () => {
      const data = table.options.data;
      if (source === data) return model;
      source = data;
      const cache = new Map<number, Row<T>>();
      const ids = new Map<number, string>();
      let indicesById: Map<string, number> | undefined;
      const getId = (index: number) => {
        let id = ids.get(index);
        if (id === undefined) {
          id = table.options.getRowId?.(data[index], index) ?? String(index);
          ids.set(index, id);
        }
        return id;
      };
      const getRow = (index: number) => {
        let row = cache.get(index);
        if (row) cache.delete(index);
        else row = createRow(table, getId(index), data[index], index, 0);
        cache.set(index, row);
        if (cache.size > Math.max(1, cacheSize)) cache.delete(cache.keys().next().value!);
        return row;
      };
      const arrayIndex = (key: string | symbol) => {
        if (typeof key !== "string") return -1;
        const index = Number(key);
        return Number.isInteger(index) && index >= 0 && index < data.length && String(index) === key
          ? index
          : -1;
      };
      const rows = new Proxy(new Array<Row<T>>(data.length), {
        get(target, key, receiver) {
          const index = arrayIndex(key);
          return index < 0 ? Reflect.get(target, key, receiver) : getRow(index);
        },
        has(target, key) {
          return arrayIndex(key) >= 0 || Reflect.has(target, key);
        },
        ownKeys() {
          return [...data.keys()].map(String).concat("length");
        },
        getOwnPropertyDescriptor(target, key) {
          const index = arrayIndex(key);
          return index < 0
            ? Reflect.getOwnPropertyDescriptor(target, key)
            : { configurable: true, enumerable: true, get: () => getRow(index) };
        },
      });
      const idIndices = () => {
        if (!indicesById) {
          indicesById = new Map();
          for (let index = 0; index < data.length; index++) indicesById.set(getId(index), index);
        }
        return indicesById;
      };
      const rowsById = new Proxy(Object.create(null) as Record<string, Row<T>>, {
        get(_, key) {
          const index = typeof key === "string" ? idIndices().get(key) : undefined;
          return index === undefined ? undefined : getRow(index);
        },
        has(_, key) {
          return typeof key === "string" && idIndices().has(key);
        },
        ownKeys() {
          return [...idIndices().keys()];
        },
        getOwnPropertyDescriptor(_, key) {
          const index = typeof key === "string" ? idIndices().get(key) : undefined;
          return index === undefined
            ? undefined
            : { configurable: true, enumerable: true, get: () => getRow(index) };
        },
      });
      model = { rows, flatRows: rows, rowsById };
      return model;
    };
  };
}
