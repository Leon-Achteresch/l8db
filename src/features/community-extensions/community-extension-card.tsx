import { motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readCommunityExtension } from "@/lib/db";
import type { ExtensionDescriptor, Permission } from "@/lib/extensions/contracts";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useExtensionHost } from "@/lib/extensions/react-context";

export function CommunityExtensionCard({
  extension,
  run,
}: {
  extension: ExtensionDescriptor;
  run: (action: () => Promise<unknown>) => void;
}) {
  const host = useExtensionHost();
  const { manifest } = extension.archive;
  const [grants, setGrants] = useState<Permission[]>(extension.grants);
  const [configuration, setConfiguration] = useState(
    JSON.stringify(extension.configuration, null, 2),
  );
  return (
    <motion.article
      layout
      transition={{ layout: SPRING_LAYOUT }}
      className="space-y-3 rounded-lg border p-4"
    >
      <div>
        <strong>{manifest.name}</strong>{" "}
        <span className="text-xs text-muted-foreground">
          {manifest.version} · {extension.state} · {extension.enabled ? "Aktiviert" : "Deaktiviert"}
        </span>
      </div>
      <p className="text-xs font-mono text-muted-foreground">{manifest.id}</p>
      <p className="text-sm text-muted-foreground">{manifest.description}</p>
      {extension.error && (
        <p role="alert" className="break-all text-xs text-destructive">
          {extension.error}
        </p>
      )}
      {!!manifest.permissions?.length && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Berechtigungen</legend>
          {manifest.permissions.map((permission) => (
            <label key={permission} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={grants.includes(permission)}
                disabled={!host.permissions.supported.includes(permission)}
                onChange={(event) =>
                  setGrants((previous) =>
                    event.target.checked
                      ? [...previous, permission]
                      : previous.filter((p) => p !== permission),
                  )
                }
              />
              {permission}
              {!host.permissions.supported.includes(permission) && " (in API v1 gesperrt)"}
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => run(() => host.enableExtension(manifest.id, grants))}>
          {extension.enabled ? "Freigaben anwenden" : "Aktivieren"}
        </Button>
        {extension.enabled && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => run(() => host.disableExtension(manifest.id))}
          >
            Deaktivieren
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            run(async () =>
              host.reloadExtension(
                manifest.id,
                extension.developmentPath
                  ? await readCommunityExtension(extension.developmentPath, true)
                  : undefined,
              ),
            )
          }
        >
          Neu laden
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => run(() => host.uninstallExtension(manifest.id))}
        >
          Deinstallieren
        </Button>
      </div>
      {extension.developmentPath && (
        <p className="break-all text-xs text-muted-foreground">
          Entwicklung: {extension.developmentPath}
        </p>
      )}
      {(manifest.contributes?.commands ?? []).map((command) => (
        <Button
          key={command.id}
          size="sm"
          variant="outline"
          disabled={!extension.enabled}
          onClick={() => run(() => host.executeCommand(command.id))}
        >
          {command.title}
        </Button>
      ))}
      {!!Object.keys(manifest.contributes?.configuration ?? {}).length && (
        <details>
          <summary className="cursor-pointer text-sm">Konfiguration</summary>
          <dl className="my-2 space-y-1 text-xs">
            {Object.entries(manifest.contributes!.configuration!).map(([key, property]) => (
              <div key={key}>
                <dt className="font-mono">
                  {key} ({property.type})
                </dt>
                <dd>
                  {property.description} · Standard: {String(property.default)}
                </dd>
              </div>
            ))}
          </dl>
          <Input
            aria-label={`Konfiguration ${manifest.id} als JSON`}
            value={configuration}
            onChange={(event) => setConfiguration(event.target.value)}
          />
          <Button
            className="mt-2"
            size="sm"
            variant="outline"
            onClick={() => run(() => host.setConfiguration(manifest.id, JSON.parse(configuration)))}
          >
            Speichern
          </Button>
        </details>
      )}
    </motion.article>
  );
}
