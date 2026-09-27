import { afterEach, describe, expect, it, vi } from "vitest";
import { createAddress, deleteAddress, getAddress, listAddresses, setDefaultAddress, updateAddress } from "./addressApi";

function jsonResponse(body: unknown, status = 200) {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}
const success = <T>(data: T) => ({ success: true, data, message: null, pagination: null, error: null });

describe("addressApi (thin wrapper over the existing /api/v1/addresses routes)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("hits the right method/URL for every operation, and never sends a userId parameter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(success({ id: "1" })));
    vi.stubGlobal("fetch", fetchMock);

    await listAddresses();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/addresses");

    await getAddress("1");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/addresses/1");

    const payload = { recipientName: "a", phone: "b", province: "c", city: "d", addressLine: "e", location: { latitude: 1, longitude: 2 } };
    await createAddress(payload as never);
    const [createUrl, createInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(createUrl).toBe("/api/v1/addresses");
    expect(createInit.method).toBe("POST");
    expect(JSON.parse(createInit.body as string)).not.toHaveProperty("userId");

    await updateAddress("1", { addressLine: "new" });
    const [, updateInit] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(updateInit.method).toBe("PATCH");

    await deleteAddress("1");
    expect((fetchMock.mock.calls[4] as [string, RequestInit])[1].method).toBe("DELETE");

    await setDefaultAddress("1");
    const [defaultUrl, defaultInit] = fetchMock.mock.calls[5] as [string, RequestInit];
    expect(defaultUrl).toBe("/api/v1/addresses/1/default");
    expect(defaultInit.method).toBe("POST");
  });
});
