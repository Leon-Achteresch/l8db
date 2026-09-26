import { createFileRoute } from "@tanstack/react-router";

import { BucketView } from "@/features/storage/bucket-view";

export const Route = createFileRoute("/_app/_workspace/buckets/$bucket")({
  component: function BucketRoute() {
    const { bucket } = Route.useParams();
    return <BucketView bucket={bucket} />;
  },
});
