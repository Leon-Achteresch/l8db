import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { DiscoverySubHost } from "@/features/discovery/discovery-sub-host";
import { FeatureSpotlightLayer } from "@/features/discovery/feature-spotlight-layer";
import { DISCOVERY_HOSTS } from "@/features/discovery/registry";
import { installDiscoveryCoordinator } from "@/lib/discovery/coordinator";
import { setHighlightNavigator } from "@/lib/discovery/highlight";
import { installFeatureUsageTracking } from "@/lib/discovery/usage";

export function DiscoveryHost() {
  const router = useRouter();

  useEffect(() => {
    const stopTracking = installFeatureUsageTracking(router);
    const stopCoordinator = installDiscoveryCoordinator();
    const stopNavigator = setHighlightNavigator({
      navigate: (href) => router.navigate({ href }),
      href: () => router.state.location.href,
    });
    return () => {
      stopTracking();
      stopCoordinator();
      stopNavigator();
    };
  }, [router]);

  return (
    <>
      <FeatureSpotlightLayer />
      {DISCOVERY_HOSTS.map((entry) => (
        <DiscoverySubHost key={entry.id} entry={entry} />
      ))}
    </>
  );
}
