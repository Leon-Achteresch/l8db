import { createFileRoute } from "@tanstack/react-router";
import { FederationView } from "@/features/federation/federation-view";

export const Route = createFileRoute("/_app/federation")({ component: FederationView });
