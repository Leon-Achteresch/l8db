import * as React from "react";

import { AppSidebarIconRail } from "@/components/sidebar/app-sidebar-icon-rail";
import { AppSidebarPanel } from "@/components/sidebar/app-sidebar-panel";
import {
  appSidebarData,
  type AppSidebarMail,
  type AppSidebarNavItem,
} from "@/components/sidebar/app-sidebar-data";
import { Sidebar, useSidebar } from "@/components/ui/sidebar";

function shuffleMails(source: AppSidebarMail[]): AppSidebarMail[] {
  const shuffled = [...source].sort(() => Math.random() - 0.5);
  const count = Math.max(5, Math.floor(Math.random() * 10) + 1);
  return shuffled.slice(0, count);
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const [activeItem, setActiveItem] = React.useState<AppSidebarNavItem>(
    appSidebarData.navMain[0],
  );
  const [mails, setMails] = React.useState(appSidebarData.mails);
  const { setOpen } = useSidebar();

  const handleNavSelect = (item: AppSidebarNavItem) => {
    setActiveItem(item);
    setMails(shuffleMails(appSidebarData.mails));
    setOpen(true);
  };

  return (
    <Sidebar
      collapsible="icon"
      className="overflow-hidden *:data-[sidebar=sidebar]:flex-row"
      {...props}
    >
      <AppSidebarIconRail
        activeItem={activeItem}
        onNavSelect={handleNavSelect}
        user={appSidebarData.user}
      />
      <AppSidebarPanel activeItem={activeItem} mails={mails} />
    </Sidebar>
  );
}
