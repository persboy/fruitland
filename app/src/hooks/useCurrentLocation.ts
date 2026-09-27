"use client";

import { useCallback, useState } from "react";
import type { Coordinates } from "@fruitland/shared";

type CurrentLocationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; coordinates: Coordinates }
  | { status: "error"; message: string };

/** Wraps browser geolocation with the states a UI actually needs: unsupported, denied, timeout, and unavailable are all just "error" with a Persian message — never thrown, never assumed available. `onSuccess` fires directly from the browser callback (not via an effect watching state), so a caller like LocationPicker can react immediately without a derived-state effect. */
export function useCurrentLocation(onSuccess?: (coordinates: Coordinates) => void) {
  const [state, setState] = useState<CurrentLocationState>({ status: "idle" });

  const request = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({ status: "error", message: "مرورگر شما از تعیین موقعیت پشتیبانی نمی‌کند" });
      return;
    }
    setState({ status: "loading" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        setState({ status: "success", coordinates });
        onSuccess?.(coordinates);
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? "اجازه‌ی دسترسی به موقعیت مکانی داده نشد"
            : error.code === error.TIMEOUT
              ? "دریافت موقعیت مکانی بیش از حد طول کشید"
              : "موقعیت مکانی در دسترس نیست";
        setState({ status: "error", message });
      },
      { timeout: 10_000, maximumAge: 60_000 },
    );
  }, [onSuccess]);

  return { state, request };
}
