import { useMutation } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  type ConvexStudioHttpRoute,
  type ConvexStudioTarget,
  convexStudioFunctionsHttpRequest,
} from "@/lib/db/convex-studio-functions";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

function parseHeaders(raw: string): [string, string][] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf(":");
      if (index <= 0) throw new Error(`Ungültiger Header: ${line}`);
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    });
}

function prettyBody(body: string, headers: [string, string][]) {
  const json = headers.some(
    ([name, value]) => name.toLowerCase() === "content-type" && value.includes("json"),
  );
  if (!json) return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export function ConvexHttpTester({
  target,
  routes,
  siteUrl,
}: {
  target: ConvexStudioTarget;
  routes: ConvexStudioHttpRoute[];
  siteUrl: string | null;
}) {
  const [method, setMethod] = useState(routes[0]?.method ?? "GET");
  const [path, setPath] = useState(routes[0]?.path ?? "/");
  const [headers, setHeaders] = useState("");
  const [body, setBody] = useState("");
  const send = useMutation({
    mutationFn: () => {
      const parsed = parseHeaders(headers);
      const sendsBody = !["GET", "HEAD"].includes(method) && body.length > 0;
      if (sendsBody && !parsed.some(([name]) => name.toLowerCase() === "content-type")) {
        let json = true;
        try {
          JSON.parse(body);
        } catch {
          json = false;
        }
        parsed.push(["content-type", json ? "application/json" : "text/plain"]);
      }
      return convexStudioFunctionsHttpRequest(target, {
        method,
        path: path.trim(),
        headers: parsed,
        body: sendsBody ? body : null,
      });
    },
  });
  const response = send.data;

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{routes.length} Routen</p>
        {routes.length === 0 && (
          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            Keine HTTP-Aktionen in convex/http.ts definiert.
          </p>
        )}
        <ul className="max-h-[60vh] space-y-1 overflow-auto">
          {routes.map((route) => {
            const active = route.method === method && route.path === path;
            return (
              <li key={`${route.componentPath}|${route.method} ${route.path}`}>
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => {
                    setMethod(route.method);
                    setPath(route.path);
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-xs ${active ? "bg-primary/10" : "hover:bg-muted"}`}
                >
                  <Badge variant="outline" className="w-14 justify-center text-[10px]">
                    {route.method}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate" title={route.path}>
                    {route.path}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="min-w-0 space-y-4">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            send.mutate();
          }}
        >
          <div className="flex flex-wrap gap-2">
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger size="sm" className="h-8 w-28 text-xs" aria-label="HTTP-Methode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex min-w-48 flex-1 items-center rounded-md border px-2 font-mono text-xs">
              {siteUrl && (
                <span className="shrink-0 text-muted-foreground">{siteUrl.replace(/\/$/, "")}</span>
              )}
              <input
                className="h-8 min-w-0 flex-1 bg-transparent outline-none"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                aria-label="Pfad mit Query-String"
                placeholder="/pfad?x=1"
              />
            </div>
            <Button size="sm" type="submit" disabled={send.isPending}>
              <Send className="size-3.5" />
              {send.isPending ? "Läuft…" : "Senden"}
            </Button>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="convex-http-headers">Header (eine pro Zeile, Name: Wert)</Label>
              <Textarea
                id="convex-http-headers"
                className="min-h-24 font-mono text-xs"
                value={headers}
                onChange={(event) => setHeaders(event.target.value)}
                placeholder="authorization: Bearer …"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="convex-http-body">Body</Label>
              <Textarea
                id="convex-http-body"
                className="min-h-24 font-mono text-xs"
                value={body}
                disabled={method === "GET" || method === "HEAD"}
                onChange={(event) => setBody(event.target.value)}
                placeholder='{"author": "l8db"}'
              />
            </div>
          </div>
        </form>
        {send.isError && (
          <p role="alert" className="text-xs text-destructive">
            {send.error instanceof Error ? send.error.message : String(send.error)}
          </p>
        )}
        {response && (
          <div className="space-y-2 rounded-xl border p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant={response.status < 400 ? "secondary" : "destructive"}>
                HTTP {response.status}
              </Badge>
              <span className="text-muted-foreground">{response.durationMs} ms</span>
              <span className="text-muted-foreground">{response.size} Bytes</span>
              {response.truncated && (
                <span className="text-amber-600">Antwort auf 1 MB gekürzt</span>
              )}
              <span className="truncate font-mono text-muted-foreground" title={response.url}>
                {response.url}
              </span>
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {response.headers.length} Header
              </summary>
              <pre className="mt-1 overflow-auto font-mono text-[11px] whitespace-pre-wrap">
                {response.headers.map(([name, value]) => `${name}: ${value}`).join("\n")}
              </pre>
            </details>
            <pre className="max-h-[50vh] overflow-auto rounded-lg bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap">
              {prettyBody(response.body, response.headers) || "(leer)"}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
