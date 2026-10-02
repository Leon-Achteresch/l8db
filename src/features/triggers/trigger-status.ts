export function triggerStatus(enabled: string): { label: string; disabled: boolean } {
  const value = enabled.trim().toUpperCase();
  if (value === "D" || value === "DISABLED") return { label: "DISABLED", disabled: true };
  if (value === "O" || value === "E" || value === "ENABLED")
    return { label: "ENABLED", disabled: false };
  return { label: value || "ENABLED", disabled: false };
}
