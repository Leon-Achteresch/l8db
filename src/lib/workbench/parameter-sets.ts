import {
  BIND_PARAM_TYPES,
  type BindParamRef,
  type BindParamValue,
  validateBindParams,
} from "@/lib/bind-params";
import { saveWorkbenchRecord } from "./records";

export interface ParameterSet {
  sql: string;
  values: Record<string, BindParamValue>;
}
export function parameterScope(connectionId: string, database: string | null, sql: string) {
  return JSON.stringify([connectionId, database, sql]);
}
export function parameterValues(refs: BindParamRef[], values: Record<string, BindParamValue>) {
  const next = Object.fromEntries(refs.map((ref) => [ref.name, values[ref.name]]));
  if (
    refs.length > 100 ||
    refs.some((ref) => !next[ref.name] || !BIND_PARAM_TYPES.includes(next[ref.name].type)) ||
    validateBindParams(refs, next).length
  )
    throw new Error("Bitte gültige Parameterwerte eingeben.");
  return next;
}
export function saveParameterSet(
  scope: string,
  name: string,
  sql: string,
  refs: BindParamRef[],
  values: Record<string, BindParamValue>,
) {
  return saveWorkbenchRecord({
    kind: "parameters",
    scope,
    name,
    value: { sql, values: parameterValues(refs, values) },
  });
}
