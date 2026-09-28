import { Button } from "@/components/ui/button";
import type { ProviderInfo } from "@/lib/db";
import { BaasOptions } from "../provider-picker/baas-options";
import { SmartPicker } from "../provider-picker/smart-picker";

export function ConnectionProviderStep({
  providers,
  provider,
  selectProvider,
  pasteConnectionString,
}: {
  providers: ProviderInfo[];
  provider: string;
  selectProvider: (id: string) => void;
  pasteConnectionString: (url?: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <SmartPicker
        providers={providers}
        selected={provider}
        onSelect={selectProvider}
        onPaste={pasteConnectionString}
      />
      <BaasOptions />
      <Button
        type="button"
        variant="ghost"
        className="self-start text-xs"
        onClick={() => pasteConnectionString()}
      >
        Ich habe schon einen Connection-String
      </Button>
    </div>
  );
}
