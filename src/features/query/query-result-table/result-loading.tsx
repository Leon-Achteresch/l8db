export function ResultLoading() {
  return (
    <div className="flex h-full items-center justify-center bg-card/40">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <svg
          className="size-4 animate-spin"
          fill="none"
          viewBox="0 0 24 24"
          role="img"
          aria-label="Wird ausgeführt"
        >
          <title>Wird ausgeführt</title>
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        Ausführen…
      </div>
    </div>
  );
}
