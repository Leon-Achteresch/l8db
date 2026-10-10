import type { ReactNode } from "react";
import { NewBadge } from "@/components/new-badge";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { copyWithToast } from "@/lib/clipboard";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { formatMenuShortcut, MENU_KEYS } from "@/lib/hotkeys";
import type { NewFeatureId } from "@/lib/new-features";

export function CopyAsMenu({
  name,
  qualifiedName,
  shortcuts = false,
  featureId,
  children,
}: {
  name: string;
  qualifiedName?: string;
  shortcuts?: boolean;
  featureId?: NewFeatureId;
  children?: ReactNode;
}) {
  const feature = useNewFeatureVisibility<HTMLDivElement>(featureId);
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger ref={feature.ref}>
        Kopieren als
        {feature.isNew && <NewBadge className="text-primary-foreground!" />}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem onSelect={() => void copyWithToast(name, "Name")}>
          Name
          {shortcuts && (
            <ContextMenuShortcut>{formatMenuShortcut(MENU_KEYS.copyName)}</ContextMenuShortcut>
          )}
        </ContextMenuItem>
        {qualifiedName && qualifiedName !== name && (
          <ContextMenuItem onSelect={() => void copyWithToast(qualifiedName, "Vollständiger Name")}>
            Vollständiger Name
            {shortcuts && (
              <ContextMenuShortcut>
                {formatMenuShortcut(MENU_KEYS.copyQualifiedName)}
              </ContextMenuShortcut>
            )}
          </ContextMenuItem>
        )}
        {children && (
          <>
            <ContextMenuSeparator />
            {children}
          </>
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
