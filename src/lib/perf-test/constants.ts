export const PERF_FILE_KIND = "l8db.perf-test";

export const PERF_FILE_VERSION = 2;

export const PERF_MIN_REPEATS = 1;

export const PERF_MAX_REPEATS = 500;

export const PERF_DEFAULT_REPEATS = 3;

export const PERF_MIN_CONCURRENCY = 1;

export const PERF_MAX_CONCURRENCY = 16;

export const PERF_DEFAULT_CONCURRENCY = 1;

export const PERF_DEFAULT_LIMIT = 1000;

export const PERF_MAX_LIMIT = 100000;

export const PERF_ANALYZE_HINT =
  "EXPLAIN ANALYZE führt die Abfrage tatsächlich aus. Der Test ist rein lesend, kann bei großen Tabellen aber Last erzeugen und dauern.";

export const PERF_TIMED_HINT =
  "Die Abfrage wird tatsächlich ausgeführt und ihre Laufzeit gemessen. Der Test ist rein lesend; mehrere parallele Läufe erzeugen echte Last auf dem Server.";
