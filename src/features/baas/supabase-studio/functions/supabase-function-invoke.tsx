import { useMutation } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { type SupabaseEdgeAuth, supabaseEdgeInvoke } from "@/lib/db/supabase-studio-edge";

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
  const json = headers.some(([name, value]) => name === "content-type" && value.includes("json"));
  if (!json) return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export function SupabaseFunctionInvoke({
  reference,
  slug,
  hasProjectKey,
}: {
  reference: string;
  slug: string;
  hasProjectKey: boolean;
}) {
  const [method, setMethod] = useState("POST");
  const [path, setPath] = useState("");
  const [query, setQuery] = useState("");
  const [headers, setHeaders] = useState("");
  const [bodyMode, setBodyMode] = useState<"json" | "text">("json");
  const [body, setBody] = useState('{\n  "name": "l8db"\n}');
  const [auth, setAuth] = useState<SupabaseEdgeAuth>(hasProjectKey ? "project" : "bearer");
  const [bearer, setBearer] = useState("");
  const invoke = useMutation({
    mutationFn: () => {
      const parsed = parseHeaders(headers);
      const sendsBody = !["GET", "HEAD"].includes(method) && body.trim().length > 0;
      if (sendsBody && bodyMode === "json") JSON.parse(body);
      if (sendsBody && !parsed.some(([name]) => name.toLowerCase() === "content-type")) {
        parsed.push(["content-type", bodyMode === "json" ? "application/json" : "text/plain"]);
      }
      return supabaseEdgeInvoke(reference, slug, {
        method,
        path,
        query,
        headers: parsed,
        body: sendsBody ? body : null,
        auth,
        bearer: auth === "bearer" ? bearer : null,
      });
    },
  });
  const response = invoke.data;

  return (
    <div className="space-y-4">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          invoke.mutate();
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
            <span className="shrink-0 text-muted-foreground">/functions/v1/{slug}/</span>
            <input
              className="h-8 min-w-0 flex-1 bg-transparent outline-none"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              aria-label="Pfad"
              placeholder="pfad"
            />
          </div>
          <Input
            className="h-8 w-48 font-mono text-xs"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Query-String"
            placeholder="a=1&b=2"
          />
          <Button size="sm" type="submit" disabled={invoke.isPending}>
            <Send className="size-3.5" />
            {invoke.isPending ? "Läuft…" : "Senden"}
          </Button>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="edge-invoke-headers">Header (eine pro Zeile, Name: Wert)</Label>
            <Textarea
              id="edge-invoke-headers"
              className="min-h-24 font-mono text-xs"
              value={headers}
              onChange={(event) => setHeaders(event.target.value)}
              placeholder="x-region: eu"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Select value={auth} onValueChange={(value) => setAuth(value as SupabaseEdgeAuth)}>
                <SelectTrigger
                  size="sm"
                  className="h-8 w-48 text-xs"
                  aria-label="Authentifizierung"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="project" disabled={!hasProjectKey}>
                    Projekt-Key
                  </SelectItem>
                  <SelectItem value="bearer">Eigener Bearer-Token</SelectItem>
                  <SelectItem value="none">Ohne Authentifizierung</SelectItem>
                </SelectContent>
              </Select>
              {auth === "bearer" && (
                <Input
                  type="password"
                  className="h-8 min-w-40 flex-1 text-xs"
                  value={bearer}
                  onChange={(event) => setBearer(event.target.value)}
                  aria-label="Bearer-Token"
                  placeholder="Benutzer-JWT"
                />
              )}
            </div>
            {!hasProjectKey && (
              <p className="text-[11px] text-muted-foreground">
                Kein Projekt-Key gespeichert: Aufruf nur mit eigenem Token.
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="edge-invoke-body">Body</Label>
              <Select
                value={bodyMode}
                onValueChange={(value) => setBodyMode(value as "json" | "text")}
              >
                <SelectTrigger size="sm" className="h-7 w-24 text-xs" aria-label="Body-Format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="text">Text</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Textarea
              id="edge-invoke-body"
              className="min-h-32 font-mono text-xs"
              value={body}
              disabled={method === "GET" || method === "HEAD"}
              onChange={(event) => setBody(event.target.value)}
            />
          </div>
        </div>
      </form>
      {invoke.isError && (
        <p role="alert" className="text-xs text-destructive">
          {invoke.error instanceof Error ? invoke.error.message : String(invoke.error)}
        </p>
      )}
      {response && (
        <div className="space-y-2 rounded-xl border p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={response.status < 400 ? "secondary" : "destructive"}>
              HTTP {response.status}
            </Badge>
            <span className="text-muted-foreground">{response.duration_ms} ms</span>
            <span className="text-muted-foreground">{response.size} Bytes</span>
            {response.truncated && <span className="text-amber-600">Antwort auf 1 MB gekürzt</span>}
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
  );
}
