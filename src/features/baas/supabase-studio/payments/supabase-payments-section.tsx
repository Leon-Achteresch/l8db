import { useQuery } from "@tanstack/react-query";
import { type ComponentType, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PAYMENT_QUERY_OPTIONS,
  type PaymentResource,
  type PaymentScope,
  paymentsKey,
  paymentsStatus,
} from "@/lib/db/payments";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { BaasSectionHeader } from "../../baas-section-header";
import type { SupabaseStudioSectionProps } from "../supabase-studio-sections";
import { PaymentsConnectCard } from "./payments-connect-card";
import { PaymentsCustomerForm } from "./payments-customer-form";
import { PaymentsPriceForm } from "./payments-price-form";
import { PaymentsProductForm } from "./payments-product-form";
import { PaymentsResourceTable } from "./payments-resource-table";
import { PaymentsRowActions } from "./payments-row-actions";
import { PaymentsScopeSelect } from "./payments-scope-select";
import { PaymentsSetupPanel } from "./payments-setup-panel";

const RESOURCES: {
  id: PaymentResource;
  label: string;
  form?: ComponentType<{ reference: string }>;
}[] = [
  { id: "products", label: "Produkte", form: PaymentsProductForm },
  { id: "prices", label: "Preise", form: PaymentsPriceForm },
  { id: "customers", label: "Kunden", form: PaymentsCustomerForm },
  { id: "subscriptions", label: "Abos" },
  { id: "invoices", label: "Rechnungen" },
];

export function SupabasePaymentsSection({ project, capabilities }: SupabaseStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.supabase.studio.payments");
  const reference = project.reference;
  const cloud = capabilities.management && !project.self_hosted;
  const status = useQuery({
    queryKey: [...paymentsKey(reference), "status"],
    queryFn: () => paymentsStatus(reference),
    enabled: cloud,
    ...PAYMENT_QUERY_OPTIONS,
  });
  const [tab, setTab] = useState("products");
  const [scope, setScope] = useState<PaymentScope>("project");
  const current = status.data;

  return (
    <div className="space-y-5">
      <BaasSectionHeader
        title="Zahlungen"
        titleRef={feature.ref}
        isNew={feature.isNew}
        description="Stripe-Produkte, Preise, Kunden, Abos und Rechnungen verwalten und Checkout mit Supabase-Auth einrichten."
        actions={
          current?.connected && (
            <div className="flex items-center gap-2 text-xs">
              {current.test_mode ? (
                <Badge variant="secondary">Testmodus</Badge>
              ) : (
                <Badge variant="destructive">LIVE</Badge>
              )}
              <span className="font-mono text-[11px] text-muted-foreground">
                {current.account_id}
              </span>
              {!current.setup_current && <Badge variant="outline">Einrichtung nötig</Badge>}
            </div>
          )
        }
      />
      {!cloud && (
        <p className="rounded-xl bg-muted/30 p-6 text-center text-xs text-muted-foreground">
          Zahlungen benötigen ein Supabase-Cloud-Projekt mit Zugangstoken.
        </p>
      )}
      {cloud && status.isLoading && (
        <p className="text-xs text-muted-foreground">Stripe-Verbindung wird geprüft…</p>
      )}
      {cloud && status.isError && (
        <p role="alert" className="text-xs text-destructive">
          {String(status.error)}
        </p>
      )}
      {cloud && current && !current.connected && (
        <PaymentsConnectCard reference={reference} status={null} />
      )}
      {cloud && current?.connected && (
        <Tabs key={reference} value={tab} onValueChange={setTab}>
          <TabsList>
            {RESOURCES.map((resource) => (
              <TabsTrigger key={resource.id} value={resource.id}>
                {resource.label}
              </TabsTrigger>
            ))}
            <TabsTrigger value="setup">Einrichtung</TabsTrigger>
            <TabsTrigger value="connection">Verbindung</TabsTrigger>
          </TabsList>
          {RESOURCES.map(({ id, form: Form }) => (
            <TabsContent key={id} value={id} className="space-y-4 pt-3">
              <PaymentsScopeSelect reference={reference} value={scope} onChange={setScope} />
              {Form && <Form reference={reference} />}
              <PaymentsResourceTable
                reference={reference}
                resource={id}
                scope={scope}
                actions={(row) => (
                  <PaymentsRowActions
                    reference={reference}
                    resource={id}
                    row={row}
                    live={!current.test_mode}
                  />
                )}
              />
            </TabsContent>
          ))}
          <TabsContent value="setup" className="pt-3">
            <PaymentsSetupPanel reference={reference} status={current} />
          </TabsContent>
          <TabsContent value="connection" className="pt-3">
            <PaymentsConnectCard reference={reference} status={current} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
