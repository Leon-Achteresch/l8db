import { Button } from "@/components/ui/button";
import type { BaasProvider } from "@/features/baas/baas-providers";
import type { ProviderInfo } from "@/lib/db";
import { BaasOptions } from "../provider-picker/baas-options";
import { SmartPicker } from "../provider-picker/smart-picker";

export function ConnectionProviderStep({
  providers,
  provider,
  selectProvider,
  pasteConnectionString,
  selectBaas,
}: {
  providers: ProviderInfo[];
  provider: string;
  selectProvider: (id: string) => void;
  pasteConnectionString: (url?: string) => void;
  selectBaas: (provider: BaasProvider) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <SmartPicker
        providers={providers}
        selected={provider}
        onSelect={selectProvider}
        onPaste={pasteConnectionString}
        hiddenIds={["supabase"]}
      />
      <BaasOptions onSelect={selectBaas} />
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
