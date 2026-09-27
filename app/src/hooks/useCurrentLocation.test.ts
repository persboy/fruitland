import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCurrentLocation } from "./useCurrentLocation";

const originalGeolocation = navigator.geolocation;
afterEach(() => {
  Object.defineProperty(navigator, "geolocation", { value: originalGeolocation, configurable: true });
});

describe("useCurrentLocation", () => {
  it("reports success and calls onSuccess with normalized {latitude, longitude}", () => {
    const getCurrentPosition = vi.fn((success) => success({ coords: { latitude: 35.7, longitude: 51.4 } }));
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useCurrentLocation(onSuccess));

    act(() => result.current.request());
    expect(result.current.state).toEqual({ status: "success", coordinates: { latitude: 35.7, longitude: 51.4 } });
    expect(onSuccess).toHaveBeenCalledWith({ latitude: 35.7, longitude: 51.4 });
  });

  it("maps permission-denied, timeout, and generic failures to Persian messages", () => {
    const PERMISSION_DENIED = 1;
    const TIMEOUT = 3;
    const cases: [number, string][] = [
      [PERMISSION_DENIED, "اجازه"],
      [TIMEOUT, "طول کشید"],
      [2, "در دسترس نیست"],
    ];
    for (const [code, expectedSubstring] of cases) {
      const getCurrentPosition = vi.fn((_success, error) => error({ code, PERMISSION_DENIED, TIMEOUT }));
      Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
      const { result } = renderHook(() => useCurrentLocation());
      act(() => result.current.request());
      expect(result.current.state.status).toBe("error");
      expect((result.current.state as { message: string }).message).toContain(expectedSubstring);
    }
  });

  it("reports unsupported when the browser has no geolocation API", () => {
    Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true });
    const { result } = renderHook(() => useCurrentLocation());
    act(() => result.current.request());
    expect(result.current.state).toEqual({ status: "error", message: "مرورگر شما از تعیین موقعیت پشتیبانی نمی‌کند" });
  });

  it("shows a loading state while the request is in flight", () => {
    const getCurrentPosition = vi.fn(); // never calls back
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
    const { result } = renderHook(() => useCurrentLocation());
    act(() => result.current.request());
    expect(result.current.state).toEqual({ status: "loading" });
  });
});
