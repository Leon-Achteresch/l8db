import { Button } from "@/components/ui/button";
import {
  BAAS_AS_DATABASE,
  BAAS_PROVIDERS,
  type BaasProvider,
} from "@/features/baas/baas-providers";
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
        extras={BAAS_AS_DATABASE.map((item) => ({
          id: item.id,
          name: BAAS_PROVIDERS.find((provider) => provider.id === item.id)?.name ?? item.id,
          category: item.category,
          onSelect: () => selectBaas(item.id),
        }))}
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
