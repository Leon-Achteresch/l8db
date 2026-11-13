import { MotionConfig } from "motion/react";
import { createRoot } from "react-dom/client";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import "@/index.css";

const groups = Array.from({ length: 50 }, (_, id) => ({ id: `group-${id}` }));
const options = Array.from({ length: 10 }, (_, id) => ({ id: String(id), label: `Tab ${id}` }));

function MotionTabsFixture() {
  return (
    <MotionConfig reducedMotion="user">
      <main className="space-y-3 bg-background p-6 text-foreground">
        {groups.map((group) => (
          <Tabs key={group.id} defaultValue="0">
            <TabsList aria-label={group.id} variant={group.id === "group-1" ? "line" : "default"}>
              {options.map((option) => (
                <TabsTrigger key={option.id} value={option.id}>
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ))}
      </main>
    </MotionConfig>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<MotionTabsFixture />);
