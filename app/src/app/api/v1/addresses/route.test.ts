import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import { GET, POST } from "./route";

vi.mock("@/lib/server/auth/guard", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/lib/server/services/addressService", () => ({ listAddresses: vi.fn(), createAddress: vi.fn() }));

const base = {
  recipientName: "علی رضایی", phone: "09120000000", province: "تهران", city: "تهران",
  addressLine: "خیابان ولیعصر", location: { latitude: 35.7, longitude: 51.4 },
};
const DTO = { id: "64b7f0c2a1b2c3d4e5f60718", ...base, district: null, neighborhood: null, street: null, alley: null, plaque: null, unit: null, postalCode: null, deliveryNotes: null, resolvedBy: null, isDefault: false, label: "home" };

const get = () => GET(new NextRequest("http://localhost/api/v1/addresses"));
const post = (body: unknown) => POST(new NextRequest("http://localhost/api/v1/addresses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("/api/v1/addresses", () => {
  let requireAuth: ReturnType<typeof vi.fn>;
  let listAddresses: ReturnType<typeof vi.fn>;
  let createAddress: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    ({ requireAuth } = (await import("@/lib/server/auth/guard")) as unknown as { requireAuth: typeof requireAuth });
    ({ listAddresses, createAddress } = (await import("@/lib/server/services/addressService")) as unknown as {
      listAddresses: typeof listAddresses;
      createAddress: typeof createAddress;
    });
    requireAuth.mockReturnValue({ userId: "u1", role: "customer" });
    listAddresses.mockResolvedValue([DTO]);
    createAddress.mockResolvedValue(DTO);
  });
  afterEach(() => vi.clearAllMocks());

  describe("GET (list)", () => {
    it("requires authentication before touching any address", async () => {
      requireAuth.mockImplementation(() => { throw AppError.unauthorized("x", "UNAUTHENTICATED"); });
      const res = await get();
      expect(res.status).toBe(401);
      expect(listAddresses).not.toHaveBeenCalled();
    });

    it("returns the current user's own addresses, scoped by the authenticated userId", async () => {
      const res = await get();
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data).toEqual([DTO]);
      expect(listAddresses).toHaveBeenCalledWith("u1");
    });
  });

  describe("POST (create)", () => {
    it("requires authentication", async () => {
      requireAuth.mockImplementation(() => { throw AppError.unauthorized("x", "UNAUTHENTICATED"); });
      expect((await post(base)).status).toBe(401);
      expect(createAddress).not.toHaveBeenCalled();
    });

    it("rejects invalid coordinates", async () => {
      const res = await post({ ...base, location: { latitude: 999, longitude: 0 } });
      expect(res.status).toBe(400);
      expect(createAddress).not.toHaveBeenCalled();
    });

    it("rejects missing required fields", async () => {
      const { addressLine, ...missing } = base;
      void addressLine;
      const res = await post(missing);
      expect(res.status).toBe(400);
      expect(createAddress).not.toHaveBeenCalled();
    });

    it("creates the address under the authenticated user, never a client-supplied userId", async () => {
      const res = await post({ ...base, userId: "someone-else" }); // client cannot inject ownership
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data).toEqual(DTO);
      expect(createAddress).toHaveBeenCalledWith("u1", expect.not.objectContaining({ userId: expect.anything() }));
    });

    it("ignores a client-supplied resolvedBy — never forwarded to the service", async () => {
      await post({ ...base, resolvedBy: { provider: "google", providerPlaceId: "fake", resolvedAt: "2020-01-01T00:00:00.000Z" } });
      const [, input] = createAddress.mock.calls[0] as [string, Record<string, unknown>];
      expect(input.resolvedBy).toBeUndefined();
    });

    it("an unexpected service error becomes a generic safe 500", async () => {
      createAddress.mockRejectedValue(new Error("connection refused at 10.0.0.9:27017"));
      const res = await post(base);
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(JSON.stringify(body)).not.toContain("10.0.0.9");
    });
  });
});
