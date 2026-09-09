import { createRoot } from "react-dom/client";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import { SidebarWindow } from "@/features/sidebar/sidebar-window";

const COUNT = 3000;

function App() {
  return (
    <div
      data-slot="sidebar-content"
      style={{
        height: 600,
        width: 260,
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <SidebarWindow count={COUNT}>
        {(index) => (
          <SidebarMenuItem key={index}>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  data-index={index}
                  style={{ display: "block", height: 32.5, width: "100%" }}
                >
                  table_{index}
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem>Anheften</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </SidebarMenuItem>
        )}
      </SidebarWindow>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
