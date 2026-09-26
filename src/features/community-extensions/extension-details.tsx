import { Button } from "@/components/ui/button";
import type { ExtensionDescriptor } from "@/lib/extensions/contracts";
import { useExtensionHost } from "@/lib/extensions/react-context";
import { ExtensionConfigurationForm } from "./extension-configuration-form";
import { ExtensionPermissionConsent } from "./extension-permission-consent";

export function ExtensionDetails({
  extension,
  guided,
  run,
}: {
  extension: ExtensionDescriptor;
  guided: boolean;
  run: (action: () => Promise<unknown>) => void;
}) {
  const host = useExtensionHost();
  const { manifest } = extension.archive;
  const id = manifest.id;
  const contributes = manifest.contributes ?? {};
  const facts = [
    ["ID", id],
    ["Version", manifest.version],
    ["Herausgeber", manifest.publisher],
    ["Status", extension.state],
    ["Ansichten", contributes.views?.map((view) => view.title).join(", ")],
    ["Panels", contributes.panels?.map((panel) => panel.title).join(", ")],
    ["Statusleiste", contributes.statusBar?.map((item) => item.id).join(", ")],
    ["Entwicklung", extension.developmentPath],
  ].filter((entry): entry is [string, string] => !!entry[1]);

  return (
    <div className="space-y-5 text-xs">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-all font-mono">{value}</dd>
          </div>
        ))}
      </dl>
      {extension.enabled && !!manifest.permissions?.length && (
        <section className="space-y-2">
          <h4 className="font-medium">Berechtigungen</h4>
          <ExtensionPermissionConsent
            extension={extension}
            confirmLabel="Freigaben anwenden"
            onConfirm={(grants) => run(() => host.enableExtension(id, grants))}
          />
        </section>
      )}
      {!guided && !!Object.keys(contributes.configuration ?? {}).length && (
        <section className="space-y-2">
          <h4 className="font-medium">Einstellungen</h4>
          <ExtensionConfigurationForm
            extension={extension}
            onChange={(values) => run(() => host.setConfiguration(id, values))}
          />
        </section>
      )}
      {!guided && !!contributes.commands?.length && (
        <section className="space-y-2">
          <h4 className="font-medium">Befehle</h4>
          <div className="flex flex-wrap gap-2">
            {contributes.commands.map((command) => (
              <Button
                key={command.id}
                size="xs"
                variant="outline"
                disabled={!extension.enabled}
                onClick={() => run(() => host.executeCommand(command.id))}
              >
                {command.title}
              </Button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
