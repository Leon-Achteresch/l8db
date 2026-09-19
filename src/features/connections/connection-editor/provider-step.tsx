import { Button } from "@/components/ui/button";
import type { ProviderInfo } from "@/lib/db";
import { ProviderTile } from "../provider-tile";

export function ConnectionProviderStep({
  groups,
  providers,
  provider,
  info,
  selectProvider,
  pasteConnectionString,
}: {
  groups: string[];
  providers: ProviderInfo[];
  provider: string;
  info: ProviderInfo;
  selectProvider: (id: string) => void;
  pasteConnectionString: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Tippe auf eine Kachel. Danach kommen nur noch Name und Zugangsdaten.
      </p>
      <div className="pr-1">
        {groups.map((group) => (
          <div key={group} className="mb-3">
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{group}</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
              {providers
                .filter((entry) => entry.group === group)
                .map((entry) => (
                  <ProviderTile
                    key={entry.id}
                    provider={entry}
                    selected={provider === entry.id}
                    onSelect={() => selectProvider(entry.id)}
                  />
                ))}
            </div>
          </div>
        ))}
      </div>
      <p className="line-clamp-2 text-[11px] text-muted-foreground">{info.hint}</p>
      <Button
        type="button"
        variant="ghost"
        className="self-start text-xs"
        onClick={pasteConnectionString}
      >
        Ich habe schon einen Connection-String
      </Button>
    </div>
  );
}
