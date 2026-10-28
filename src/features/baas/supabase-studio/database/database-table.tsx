import type { ReactNode } from "react";

export function DatabaseTable({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <table className="w-full text-left text-xs">
      <thead className="bg-muted/40 text-muted-foreground">
        <tr>
          {headers.map((header) => (
            <th key={header} className="px-3 py-2 font-medium whitespace-nowrap">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y [&_td]:px-3 [&_td]:py-2 [&_td]:align-top">{children}</tbody>
    </table>
  );
}
