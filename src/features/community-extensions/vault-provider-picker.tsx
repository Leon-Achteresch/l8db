import { useId } from "react";
import { cn } from "@/lib/utils";
import { VAULT_PROVIDERS, type VaultProvider } from "./password-manager";

export function VaultProviderPicker({
  value,
  onChange,
  disabled,
}: {
  value?: VaultProvider;
  onChange: (provider: VaultProvider) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label="Passwortmanager"
      className="grid gap-2 @min-[40rem]:grid-cols-3"
    >
      {VAULT_PROVIDERS.map((provider) => (
        <label
          key={provider.id}
          className="flex cursor-pointer items-center gap-3 rounded-xl border bg-background p-3 shadow-xs transition-[border-color,box-shadow,scale] duration-150 ease-out hover:border-foreground/25 active:scale-[0.98] has-checked:border-primary has-checked:ring-3 has-checked:ring-primary/15 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring has-disabled:pointer-events-none has-disabled:opacity-60"
        >
          <input
            type="radio"
            name={name}
            value={provider.id}
            checked={value === provider.id}
            disabled={disabled}
            onChange={() => onChange(provider.id)}
            className="sr-only"
          />
          <span
            aria-hidden
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold shadow-xs",
              provider.tone,
            )}
          >
            {provider.mark}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{provider.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{provider.tagline}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
