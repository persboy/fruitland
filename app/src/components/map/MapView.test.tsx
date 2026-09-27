import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MapRendererProps } from "./MapRenderer";
import { MapView } from "./MapView";

const point = { latitude: 36.6769, longitude: 48.4963 };
const other = { latitude: 36.7, longitude: 48.5 };

function FakeRenderer({ center, marker, onMapClick }: MapRendererProps) {
  return (
    <button type="button" data-testid="fake-map" onClick={() => onMapClick(other)}>
      center:{center.latitude},{center.longitude} marker:{marker ? `${marker.latitude},${marker.longitude}` : "none"}
    </button>
  );
}

describe("MapView", () => {
  afterEach(cleanup);

  it("renders with the injected renderer and passes through initial coordinates", () => {
    render(<MapView center={point} marker={point} renderer={FakeRenderer} />);
    expect(screen.getByTestId("fake-map")).toHaveTextContent(`center:${point.latitude},${point.longitude}`);
    expect(screen.getByTestId("fake-map")).toHaveTextContent(`marker:${point.latitude},${point.longitude}`);
  });

  it("renders with no marker when none is selected", () => {
    render(<MapView center={point} renderer={FakeRenderer} />);
    expect(screen.getByTestId("fake-map")).toHaveTextContent("marker:none");
  });

  it("reports a map interaction (click) up to the caller with normalized {latitude, longitude}", () => {
    const onMapClick = vi.fn();
    render(<MapView center={point} onMapClick={onMapClick} renderer={FakeRenderer} />);
    screen.getByTestId("fake-map").click();
    expect(onMapClick).toHaveBeenCalledWith(other);
  });

  it("handles provider (renderer) initialization failure without crashing the page", async () => {
    function BrokenRenderer(): never {
      throw new Error("chunk load failed");
    }
    // Errors are expected here; keep the test output clean.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<MapView center={point} renderer={BrokenRenderer} />);
    await waitFor(() => expect(screen.getByText("نقشه بارگذاری نشد")).toBeInTheDocument());
    spy.mockRestore();
  });

  it("shows a loading fallback while the default (lazy) renderer's module is loading", () => {
    render(<MapView center={point} />);
    // The real Leaflet renderer loads asynchronously; before it resolves, the Suspense fallback (a Skeleton) is shown.
    expect(screen.queryByRole("application")).not.toBeInTheDocument();
  });
});
