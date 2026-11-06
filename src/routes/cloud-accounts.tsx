import { createFileRoute } from "@tanstack/react-router";
import { CloudAccountsView } from "@/features/cloud-accounts/cloud-accounts-view";

export const Route = createFileRoute("/cloud-accounts")({ component: CloudAccountsView });
