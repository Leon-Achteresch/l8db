import { Component, type ReactNode } from "react";
import { reportUiPluginError } from "@/lib/ui-plugins/store";

type PluginBoundaryProps = {
  plugin: string;
  fallback: ReactNode;
  resetKey?: unknown;
  children: ReactNode;
};

export class PluginBoundary extends Component<PluginBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    reportUiPluginError(this.props.plugin, error);
  }

  componentDidUpdate(previous: PluginBoundaryProps) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey)
      this.setState({ failed: false });
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
