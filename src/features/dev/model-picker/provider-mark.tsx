import { Server } from "lucide-react";
import { ThesvgIcon } from "@/components/provider-logo";
import { aiProviderSvg } from "@/features/ai/ai-provider-icons";

export function ProviderMark({ id, className }: { id: string; className: string }) {
  const svg = aiProviderSvg(id);
  return svg ? <ThesvgIcon svg={svg} className={className} /> : <Server className={className} />;
}
