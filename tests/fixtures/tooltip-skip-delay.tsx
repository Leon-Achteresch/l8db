import {
  CopyIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlayIcon,
  SaveIcon,
  TrashIcon,
} from "lucide-react";
import { createRoot } from "react-dom/client";
import { IconButton } from "../../src/components/icon-button";
import { IconMenu } from "../../src/components/icon-menu/icon-menu";
import { IconMenuContent } from "../../src/components/icon-menu/icon-menu-content";
import { IconMenuItem } from "../../src/components/icon-menu/icon-menu-item";
import { IconMenuSeparator } from "../../src/components/icon-menu/icon-menu-separator";
import { IconMenuSubTrigger } from "../../src/components/icon-menu/icon-menu-sub-trigger";
import { ICON_MENU_SUB_BELOW } from "../../src/components/icon-menu/shared";
import { Button } from "../../src/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from "../../src/components/ui/dropdown-menu";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import "../../src/index.css";

const icons = [PlayIcon, SaveIcon, CopyIcon, PencilIcon, TrashIcon];

function Fixture() {
  return (
    <TooltipProvider>
      <div style={{ display: "flex", gap: 24, padding: 120 }}>
        <div data-testid="toolbar" style={{ display: "flex", gap: 6 }}>
          {icons.map((Icon, index) => (
            <IconButton
              key={Icon.displayName}
              variant="ghost"
              size="icon-sm"
              aria-label={`Knopf ${index + 1}`}
            >
              <Icon />
            </IconButton>
          ))}
          <Button size="sm" disabled disabledReason="Gesperrt">
            Los
          </Button>
        </div>
        <IconMenu defaultOpen modal={false}>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="Weitere Werkzeuge">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <IconMenuContent align="start" side="bottom" sideOffset={80}>
            {icons.slice(0, 3).map((Icon, index) => (
              <IconMenuItem key={Icon.displayName} icon={<Icon />} label={`Menü ${index + 1}`} />
            ))}
            <IconMenuSeparator />
            {icons.slice(3).map((Icon, index) => (
              <IconMenuItem key={Icon.displayName} icon={<Icon />} label={`Menü ${index + 4}`} />
            ))}
            <IconMenuItem icon={<SaveIcon />} label="Menü gesperrt" disabled />
            <IconMenuSeparator />
            <DropdownMenuSub>
              <IconMenuSubTrigger icon={<PlayIcon />} label="Anzeige" />
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="w-64" {...ICON_MENU_SUB_BELOW}>
                  <DropdownMenuItem>Original</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </IconMenuContent>
        </IconMenu>
      </div>
    </TooltipProvider>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
