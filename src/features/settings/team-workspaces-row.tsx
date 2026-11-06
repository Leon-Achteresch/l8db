import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SettingsRow } from "@/features/settings/settings-row";
import { WorkspaceIntro } from "@/features/workspaces/workspace-intro";
import { WorkspacesPanel } from "@/features/workspaces/workspaces-panel";

export function TeamWorkspacesRow() {
  return (
    <SettingsRow settingId="team-workspaces" featureId="settings.general.workspaces">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            Öffnen
          </Button>
        </DialogTrigger>
        <DialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Team-Workspaces</DialogTitle>
            <DialogDescription>
              Gemeinsame Verbindungen, Rechte, SQL-Abfragen und Freigaben für euer Team.
            </DialogDescription>
          </DialogHeader>
          <WorkspaceIntro />
          <WorkspacesPanel />
        </DialogContent>
      </Dialog>
    </SettingsRow>
  );
}
