import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function LiveInfoCard({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <Card size="sm" className="min-w-0">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[minmax(130px,auto)_1fr] gap-x-4 gap-y-2 text-xs">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="truncate font-mono" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
