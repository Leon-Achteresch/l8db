export interface RegexSearchOptions {
  caseSensitive?: boolean;
  multiline?: boolean;
  dotAll?: boolean;
  global?: boolean;
}

export interface RegexCompileError {
  message: string;
  index: number | null;
}

export type RegexCompileResult =
  | { ok: true; regex: RegExp; flags: string }
  | { ok: false; error: RegexCompileError };

export type SearchPatternCompileResult =
  | { ok: true; regexes: RegExp[]; flags: string }
  | { ok: false; error: RegexCompileError };

export interface RegexPatternTemplate {
  id: string;
  label: string;
  pattern: string;
  description: string;
}
