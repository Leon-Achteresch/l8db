import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { GuideLayer } from "@/features/discovery/guide/guide-layer";
import { onGuideLocation, setGuideNavigator, stopGuide, useGuide } from "@/lib/discovery/guide";

export function GuideHost() {
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const guide = useGuide();

  useEffect(() => {
    const release = setGuideNavigator({
      navigate: (href) => router.navigate({ href }),
      href: () => router.state.location.href,
    });
    return () => {
      release();
      stopGuide();
    };
  }, [router]);

  useEffect(() => {
    onGuideLocation(pathname);
  }, [pathname]);

  return guide ? <GuideLayer /> : null;
}
