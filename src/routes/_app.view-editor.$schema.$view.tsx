import { createFileRoute } from "@tanstack/react-router";

import { ViewEditorPage } from "@/pages/ViewEditorPage";

export const Route = createFileRoute("/_app/view-editor/$schema/$view")({
  component: function ViewEditorTab() {
    const { schema, view } = Route.useParams();
    return <ViewEditorPage schema={schema} view={view} />;
  },
});
