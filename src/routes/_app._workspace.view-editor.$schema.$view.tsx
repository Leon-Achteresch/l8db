import { createFileRoute } from "@tanstack/react-router";

import { ViewEditorView } from "@/features/view-editor/view-editor-view";

export const Route = createFileRoute("/_app/_workspace/view-editor/$schema/$view")({
  component: function ViewEditorRoute() {
    const { schema, view } = Route.useParams();
    return <ViewEditorView schema={schema} view={view} />;
  },
});
