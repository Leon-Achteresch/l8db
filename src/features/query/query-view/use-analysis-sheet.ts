import { useState } from "react";

import type { AnalysisSection } from "./types";

export function useAnalysisSheet() {
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisSection, setAnalysisSection] = useState<AnalysisSection>("plan");
  const openAnalysis = (section: AnalysisSection) => {
    setAnalysisSection(section);
    setAnalysisOpen(true);
  };
  return {
    open: analysisOpen,
    openAnalysis,
    onOpenChange: (open: boolean) => {
      setAnalysisOpen(open);
      if (!open) setAnalysisSection("plan");
    },
    section: analysisSection,
    onSectionChange: setAnalysisSection,
  };
}
