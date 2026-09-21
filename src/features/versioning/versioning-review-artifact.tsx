import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Artifact = {
  sql: string[];
  policyRevision: number;
  binding: { label: string; edition: string | null };
  execution: {
    fromId: string;
    reference: { id: string; commit: string };
    releases: {
      id: string;
      objects: { schema: string; name: string; definition: string }[];
      preconditions: { id: string; sql: string; expected: string }[];
      postconditions: { id: string; sql: string; expected: string }[];
    }[];
  };
};

export function VersioningReviewArtifact({ content }: { content: string }) {
  let artifact: Artifact;
  try {
    artifact = JSON.parse(content) as Artifact;
    if (
      !Array.isArray(artifact.sql) ||
      !artifact.sql.every((sql) => typeof sql === "string") ||
      !artifact.binding ||
      !artifact.execution?.reference ||
      !Array.isArray(artifact.execution.releases) ||
      artifact.execution.releases.some(
        (release) =>
          !release ||
          !Array.isArray(release.objects) ||
          release.objects.some((object) => !object || typeof object.definition !== "string") ||
          !Array.isArray(release.preconditions) ||
          !Array.isArray(release.postconditions) ||
          [...release.preconditions, ...release.postconditions].some(
            (check) => !check || typeof check.sql !== "string",
          ),
      )
    )
      throw new Error("Invalid artifact");
  } catch {
    return (
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px]">
        {content}
      </pre>
    );
  }
  const code =
    "max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/30 p-3 font-mono text-[11px]";
  return (
    <Tabs defaultValue="sql" className="my-3">
      <TabsList className="w-full justify-start bg-transparent">
        <TabsTrigger value="sql">SQL</TabsTrigger>
        <TabsTrigger value="schema">Sollstand</TabsTrigger>
        <TabsTrigger value="checks">Prüfungen</TabsTrigger>
        <TabsTrigger value="context">Kontext</TabsTrigger>
      </TabsList>
      <TabsContent value="sql">
        <pre className={code}>{artifact.sql.join("\n\n")}</pre>
      </TabsContent>
      <TabsContent value="schema" className="space-y-3">
        {artifact.execution.releases.map((release) => (
          <div key={release.id}>
            <p className="mb-2 font-medium">{release.id}</p>
            {release.objects.map((object) => (
              <details key={`${object.schema}.${object.name}`} className="py-2">
                <summary className="cursor-pointer">
                  {object.schema}.{object.name}
                </summary>
                <pre className={code}>{object.definition}</pre>
              </details>
            ))}
          </div>
        ))}
      </TabsContent>
      <TabsContent value="checks" className="space-y-3">
        {artifact.execution.releases.map((release) => (
          <div key={release.id}>
            <p className="mb-2 font-medium">{release.id}</p>
            {(["preconditions", "postconditions"] as const).map((phase) => (
              <div key={phase}>
                <p className="text-muted-foreground">
                  {phase === "preconditions" ? "Vorher" : "Nachher"}
                </p>
                {release[phase].length ? (
                  release[phase].map((check) => (
                    <div key={check.id} className="my-2">
                      <p>
                        {check.id} · Erwartet: {check.expected}
                      </p>
                      <pre className={code}>{check.sql}</pre>
                    </div>
                  ))
                ) : (
                  <p className="my-2 text-muted-foreground">Keine Prüfungen definiert</p>
                )}
              </div>
            ))}
          </div>
        ))}
      </TabsContent>
      <TabsContent value="context" className="space-y-2 break-words text-muted-foreground">
        <p>
          {artifact.binding.label}
          {artifact.binding.edition ? ` · ${artifact.binding.edition}` : ""}
        </p>
        <p>
          {artifact.execution.fromId} → {artifact.execution.reference.id}
        </p>
        <p>Regelrevision {artifact.policyRevision}</p>
        <p className="font-mono">Commit {artifact.execution.reference.commit}</p>
      </TabsContent>
    </Tabs>
  );
}
