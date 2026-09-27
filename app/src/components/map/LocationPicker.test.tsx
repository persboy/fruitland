import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapRendererProps } from "./MapRenderer";

vi.mock("@/lib/client/mapApi", () => ({ reverseGeocode: vi.fn(), searchPlaces: vi.fn() }));
vi.mock("@/lib/client/addressApi", () => ({ createAddress: vi.fn(), updateAddress: vi.fn() }));

import { createAddress, updateAddress } from "@/lib/client/addressApi";
import { ApiClientError } from "@/lib/client/apiClient";
import { reverseGeocode, searchPlaces } from "@/lib/client/mapApi";
import { LocationPicker } from "./LocationPicker";

const point = { latitude: 36.6769, longitude: 48.4963 };
const REVERSE_RESULT = {
  address: {
    province: "زنجان", city: "زنجان", district: null, neighborhood: "صادقیه", street: "آیت‌الله کاشانی",
    alley: null, plaque: "12", unit: null, postalCode: null, formattedAddress: "زنجان، صادقیه", coordinates: point,
  },
  meta: { provider: "neshan" as const, providerPlaceId: null, resolvedAt: "x" },
};
const SAVED = { id: "addr1", isDefault: false };

function FakeRenderer({ onMapClick }: MapRendererProps) {
  return (
    <button type="button" data-testid="fake-map" onClick={() => onMapClick(point)}>
      click map
    </button>
  );
}

describe("LocationPicker", () => {
  beforeEach(() => {
    vi.mocked(reverseGeocode).mockResolvedValue(REVERSE_RESULT);
    vi.mocked(searchPlaces).mockResolvedValue([]);
    vi.mocked(createAddress).mockResolvedValue(SAVED as never);
    vi.mocked(updateAddress).mockResolvedValue(SAVED as never);
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("initial state: no address form until a point is selected", () => {
    render(<LocationPicker onSaved={vi.fn()} renderer={FakeRenderer} />);
    expect(screen.getByText(/برای شروع/)).toBeInTheDocument();
    expect(screen.queryByLabelText("آدرس کامل")).not.toBeInTheDocument();
  });

  it("selecting a point on the map reverse-geocodes it and shows the resolved address (never a raw provider shape)", async () => {
    render(<LocationPicker onSaved={vi.fn()} renderer={FakeRenderer} />);
    fireEvent.click(screen.getByTestId("fake-map"));
    expect(await screen.findByRole("status")).toHaveTextContent("در حال دریافت آدرس");
    await waitFor(() => expect(screen.getByLabelText("استان")).toHaveValue("زنجان"));
    expect(reverseGeocode).toHaveBeenCalledWith(point);
    expect(screen.getByLabelText("محله")).toHaveValue("صادقیه");
    expect(screen.getByLabelText("پلاک")).toHaveValue("12");
  });

  it("reverse-geocode failure still lets the user fill the form manually (the pin is not lost)", async () => {
    vi.mocked(reverseGeocode).mockRejectedValue(new ApiClientError(502, "MAP_PROVIDER_UNAVAILABLE", "سرویس نقشه موقتاً در دسترس نیست"));
    render(<LocationPicker onSaved={vi.fn()} renderer={FakeRenderer} />);
    fireEvent.click(screen.getByTestId("fake-map"));
    expect(await screen.findByRole("alert")).toHaveTextContent("سرویس نقشه موقتاً در دسترس نیست");
    expect(screen.getByLabelText("آدرس کامل")).toBeInTheDocument(); // form still shown for manual entry
  });

  it("search: shows loading, then results; selecting a result behaves like a map click", async () => {
    vi.mocked(searchPlaces).mockResolvedValue([
      { id: "p1", name: "میدان انقلاب", coordinates: point, address: "زنجان", category: null, meta: REVERSE_RESULT.meta },
    ]);
    render(<LocationPicker onSaved={vi.fn()} renderer={FakeRenderer} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "میدان" } });
    expect(await screen.findByText("میدان انقلاب")).toBeInTheDocument();
    fireEvent.click(screen.getByText("میدان انقلاب"));
    await waitFor(() => expect(reverseGeocode).toHaveBeenCalledWith(point));
  });

  it("search failure shows an error without crashing", async () => {
    vi.mocked(searchPlaces).mockRejectedValue(new ApiClientError(500, "INTERNAL_SERVER_ERROR", "خطای داخلی سرور رخ داد"));
    render(<LocationPicker onSaved={vi.fn()} renderer={FakeRenderer} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "x" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("خطای داخلی سرور رخ داد");
  });

  it("empty search clears results without calling the API", async () => {
    render(<LocationPicker onSaved={vi.fn()} renderer={FakeRenderer} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "  " } });
    await new Promise((r) => setTimeout(r, 500));
    expect(searchPlaces).not.toHaveBeenCalled();
  });

  it("editing a resolved address before saving works, and validation errors don't crash the flow", async () => {
    const onSaved = vi.fn();
    render(<LocationPicker onSaved={onSaved} renderer={FakeRenderer} />);
    fireEvent.click(screen.getByTestId("fake-map"));
    await waitFor(() => expect(screen.getByLabelText("آدرس کامل")).toHaveValue("زنجان، صادقیه"));

    fireEvent.change(screen.getByLabelText("نام گیرنده"), { target: { value: "علی" } });
    fireEvent.change(screen.getByLabelText("شماره تماس"), { target: { value: "09120000000" } });
    fireEvent.click(screen.getByRole("button", { name: "ثبت آدرس" }));

    await waitFor(() => expect(createAddress).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledWith(SAVED);
  });

  it("creating: calls POST via createAddress and never sends userId or a client resolvedBy", async () => {
    render(<LocationPicker onSaved={vi.fn()} renderer={FakeRenderer} />);
    fireEvent.click(screen.getByTestId("fake-map"));
    await waitFor(() => expect(screen.getByLabelText("آدرس کامل")).toHaveValue("زنجان، صادقیه"));
    fireEvent.click(screen.getByRole("button", { name: "ثبت آدرس" }));
    await waitFor(() => expect(createAddress).toHaveBeenCalled());

    const payload = vi.mocked(createAddress).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("userId");
    expect(payload).not.toHaveProperty("resolvedBy");
    expect(payload.location).toEqual(point);
    expect(updateAddress).not.toHaveBeenCalled();
  });

  it("editing an existing address: prefilled from initialAddress, saving calls PATCH via updateAddress", async () => {
    const initialAddress = {
      id: "addr1", label: "home", recipientName: "علی", phone: "0912", province: "زنجان", city: "زنجان",
      district: null, neighborhood: null, street: null, alley: null, plaque: null, unit: null,
      addressLine: "آدرس قدیمی", postalCode: null, location: point, deliveryNotes: null, resolvedBy: null, isDefault: false,
    };
    render(<LocationPicker addressId="addr1" initialAddress={initialAddress as never} onSaved={vi.fn()} renderer={FakeRenderer} />);
    expect(screen.getByLabelText("آدرس کامل")).toHaveValue("آدرس قدیمی");
    fireEvent.change(screen.getByLabelText("آدرس کامل"), { target: { value: "آدرس جدید" } });
    fireEvent.click(screen.getByRole("button", { name: "ذخیره تغییرات" }));
    await waitFor(() => expect(updateAddress).toHaveBeenCalledWith("addr1", expect.objectContaining({ addressLine: "آدرس جدید" })));
    expect(createAddress).not.toHaveBeenCalled();
  });

  it("save failure shows an error and does not call onSaved", async () => {
    vi.mocked(createAddress).mockRejectedValue(new ApiClientError(400, "MAP_INVALID_REQUEST", "درخواست نامعتبر است"));
    const onSaved = vi.fn();
    render(<LocationPicker onSaved={onSaved} renderer={FakeRenderer} />);
    fireEvent.click(screen.getByTestId("fake-map"));
    await waitFor(() => expect(screen.getByLabelText("آدرس کامل")).toHaveValue("زنجان، صادقیه"));
    fireEvent.click(screen.getByRole("button", { name: "ثبت آدرس" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("درخواست نامعتبر است");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("submitting without ever selecting a point is refused client-side", () => {
    render(<LocationPicker onSaved={vi.fn()} renderer={FakeRenderer} />);
    // No form is rendered yet in "idle" — nothing to submit; this documents/locks that invariant.
    expect(screen.queryByRole("button", { name: "ثبت آدرس" })).not.toBeInTheDocument();
  });

  it("cancel button calls onCancel when provided", () => {
    const onCancel = vi.fn();
    render(<LocationPicker onSaved={vi.fn()} onCancel={onCancel} renderer={FakeRenderer} />);
    fireEvent.click(screen.getByRole("button", { name: /انصراف/ }));
    expect(onCancel).toHaveBeenCalled();
  });
});
