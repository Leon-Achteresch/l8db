export { REGEX_PATTERN_LIBRARY } from "./pattern-library";
export {
  compileSearchPatterns,
  escapeRegexLiteral,
  regexSearchFlags,
  splitSearchPatterns,
} from "./patterns";
export type {
  RegexCompileError,
  RegexCompileResult,
  RegexPatternTemplate,
  RegexSearchOptions,
  SearchPatternCompileResult,
} from "./types";

import "./scan-issue";

export {
  compileRegexSearch,
  countRegexMatches,
  describeRegexError,
  insertRegexPattern,
  regexLiteralPrefilter,
} from "./compile";
