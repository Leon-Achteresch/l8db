export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span>{label}</span>
      {children}
    </div>
  );
}
