"use client";

import { useEffect, useState } from "react";
import type { Coordinates, PlaceResult } from "@fruitland/shared";
import { LocateFixed, Loader2, Search, X } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { AddressForm, addressFormFromPartial, emptyAddressForm, type AddressFormValues } from "@/components/address/AddressForm";
import { createAddress, updateAddress, type AddressDto } from "@/lib/client/addressApi";
import { ApiClientError } from "@/lib/client/apiClient";
import { reverseGeocode, searchPlaces } from "@/lib/client/mapApi";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { MapRendererComponent } from "./MapRenderer";
import { MapView } from "./MapView";

const DEFAULT_CENTER: Coordinates = { latitude: 35.6892, longitude: 51.389 }; // Tehran — only a starting view before any real selection
const SEARCH_DEBOUNCE_MS = 400;

type Step =
  | { name: "idle" }
  | { name: "resolving" }
  | { name: "resolve-error"; message: string }
  | { name: "ready" };

function errorText(err: unknown): string {
  return err instanceof ApiClientError ? err.message : "ارتباط با سرور برقرار نشد";
}

export interface LocationPickerProps {
  /** Present → PATCH this address; absent → POST a new one. */
  addressId?: string;
  /** Prefills the map/form when editing an existing address. */
  initialAddress?: AddressDto;
  onSaved: (address: AddressDto) => void;
  onCancel?: () => void;
  /** Test/renderer-swap seam — forwarded to MapView. */
  renderer?: MapRendererComponent;
}

/**
 * The full location-selection workflow, built ONLY from already-existing
 * pieces: MapView (rendering), the internal /api/v1/maps/* endpoints
 * (search, reverse-geocode — never a provider SDK directly), AddressForm
 * (editing), and the Address API (persistence). No provider-specific
 * response shape ever reaches this component; everything here is
 * Coordinates/PlaceResult/ReverseGeocodeResult/AddressDto — the shared,
 * normalized types.
 */
export function LocationPicker({ addressId, initialAddress, onSaved, onCancel, renderer }: LocationPickerProps) {
  const [coordinates, setCoordinates] = useState<Coordinates | null>(initialAddress?.location ?? null);
  const [step, setStep] = useState<Step>(initialAddress ? { name: "ready" } : { name: "idle" });
  const [form, setForm] = useState<AddressFormValues>(initialAddress ? addressFormFromPartial(initialAddress) : emptyAddressForm);

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const [searchState, setSearchState] = useState<{ status: "idle" | "loading" | "error"; results: PlaceResult[]; message?: string }>({
    status: "idle",
    results: [],
  });

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { state: locationState, request: requestCurrentLocation } = useCurrentLocation(selectPoint);

  // Search-as-you-type against the internal API only — never a provider SDK.
  // "loading" is set synchronously from the input's onChange (a real event handler); this effect
  // only ever calls setState from inside the async callbacks, never synchronously at the top.
  useEffect(() => {
    const term = debouncedQuery.trim();
    if (!term) return;
    let cancelled = false;
    const controller = new AbortController();
    searchPlaces(term, { near: coordinates ?? undefined, limit: 5, signal: controller.signal })
      .then((results) => {
        if (!cancelled) setSearchState({ status: "idle", results });
      })
      .catch((err: unknown) => {
        if (!cancelled) setSearchState({ status: "error", results: [], message: errorText(err) });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // coordinates intentionally omitted: search bias should use whatever point was current when typing started, not restart on every marker move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);


  function selectPoint(point: Coordinates) {
    setCoordinates(point);
    setQuery("");
    setSearchState({ status: "idle", results: [] });
    setStep({ name: "resolving" });
    reverseGeocode(point)
      .then((result) => {
        setForm((prev) => ({
          ...addressFormFromPartial({ ...result.address, addressLine: result.address.formattedAddress || prev.addressLine }),
          // Never overwrite what the user already typed for recipient/phone/label when re-picking a point.
          recipientName: prev.recipientName,
          phone: prev.phone,
          label: prev.label,
          deliveryNotes: prev.deliveryNotes,
        }));
        setStep({ name: "ready" });
      })
      .catch((err: unknown) => {
        // Reverse-geocode failing does not lose the pin — the user can still fill the form manually.
        setStep({ name: "resolve-error", message: errorText(err) });
      });
  }

  function selectSearchResult(place: PlaceResult) {
    selectPoint(place.coordinates);
  }

  async function handleSubmit(values: AddressFormValues) {
    if (!coordinates) {
      setSaveError("ابتدا یک نقطه روی نقشه انتخاب کنید");
      return;
    }
    setSaveError(null);
    setSaving(true);
    // Only real, non-empty IAddress fields are sent — "" becomes undefined, never a fabricated value.
    // `resolvedBy` is never part of this payload; the server alone decides provenance (see CLAUDE.md).
    const payload = {
      label: values.label,
      recipientName: values.recipientName,
      phone: values.phone,
      province: values.province,
      city: values.city,
      district: values.district || undefined,
      neighborhood: values.neighborhood || undefined,
      street: values.street || undefined,
      alley: values.alley || undefined,
      plaque: values.plaque || undefined,
      unit: values.unit || undefined,
      addressLine: values.addressLine,
      postalCode: values.postalCode || undefined,
      deliveryNotes: values.deliveryNotes || undefined,
      location: coordinates,
    };
    try {
      const saved = addressId ? await updateAddress(addressId, payload) : await createAddress(payload);
      onSaved(saved);
    } catch (err) {
      setSaveError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
      <Card className="flex flex-1 flex-col gap-3 p-3 sm:min-w-0">
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300" aria-hidden="true" />
          <input
            type="text"
            role="searchbox"
            aria-label="جستجوی مکان"
            placeholder="جستجوی خیابان، محله یا مکان..."
            value={query}
            onChange={(e) => {
              const next = e.target.value;
              setQuery(next);
              setSearchState(next.trim() ? { status: "loading", results: [] } : { status: "idle", results: [] });
            }}
            className="w-full rounded-full border border-gray-200 bg-white py-2.5 pr-9 pl-4 text-sm text-gray-800 outline-none focus:border-emerald-400"
          />
          {searchState.status === "loading" && (
            <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-300" aria-hidden="true" />
          )}
        </div>

        {searchState.status === "error" && (
          <p role="alert" className="text-xs font-semibold text-red-500">
            {searchState.message}
          </p>
        )}
        {searchState.results.length > 0 && (
          <ul role="listbox" aria-label="نتایج جستجو" className="max-h-40 overflow-y-auto rounded-xl border border-gray-100">
            {searchState.results.map((place, i) => (
              <li key={place.id ?? i}>
                <button
                  type="button"
                  onClick={() => selectSearchResult(place)}
                  className="w-full cursor-pointer px-3 py-2 text-right text-sm text-gray-700 hover:bg-gray-50"
                >
                  <span className="block font-medium">{place.name}</span>
                  {place.address && <span className="block text-xs text-gray-400">{place.address}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim() && searchState.status === "idle" && searchState.results.length === 0 && (
          <p className="text-xs text-gray-400">نتیجه‌ای یافت نشد</p>
        )}

        <div className="h-64 overflow-hidden rounded-xl sm:h-80">
          <MapView center={coordinates ?? DEFAULT_CENTER} marker={coordinates} onMapClick={selectPoint} renderer={renderer} />
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={requestCurrentLocation}
          isLoading={locationState.status === "loading"}
        >
          <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />
          موقعیت فعلی من
        </Button>
        {locationState.status === "error" && (
          <p role="alert" className="text-xs font-semibold text-red-500">
            {locationState.message}
          </p>
        )}
      </Card>

      <Card className="flex flex-1 flex-col gap-3 p-4 sm:min-w-0">
        {step.name === "idle" && <p className="text-sm text-gray-400">برای شروع، روی نقشه بزنید، جستجو کنید یا موقعیت فعلی خود را انتخاب کنید.</p>}
        {step.name === "resolving" && (
          <p role="status" className="flex items-center gap-1.5 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            در حال دریافت آدرس...
          </p>
        )}
        {step.name === "resolve-error" && (
          <p role="alert" className="text-xs font-semibold text-red-500">
            {step.message} — می‌توانید آدرس را دستی تکمیل کنید.
          </p>
        )}
        {(step.name === "ready" || step.name === "resolve-error") && (
          <AddressForm
            value={form}
            onChange={setForm}
            onSubmit={handleSubmit}
            submitLabel={addressId ? "ذخیره تغییرات" : "ثبت آدرس"}
            saving={saving}
            error={saveError}
          />
        )}
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            انصراف
          </Button>
        )}
      </Card>
    </div>
  );
}
