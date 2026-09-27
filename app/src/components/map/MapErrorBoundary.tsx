"use client";

import { Component, type ReactNode } from "react";
import { MapPinOff } from "lucide-react";
import { StateMessage } from "@/components/ui";

interface Props {
  children: ReactNode;
}
interface State {
  failed: boolean;
}

/** Catches a failed map-renderer chunk load (e.g. offline) so one broken map never takes down the whole page. */
export class MapErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <StateMessage
          tone="error"
          icon={MapPinOff}
          title="نقشه بارگذاری نشد"
          description="اتصال اینترنت خود را بررسی کنید و صفحه را دوباره بارگذاری کنید."
        />
      );
    }
    return this.props.children;
  }
}
