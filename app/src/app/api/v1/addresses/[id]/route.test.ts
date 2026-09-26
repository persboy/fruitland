import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import { GET, PATCH, DELETE } from "./route";

vi.mock("@/lib/server/auth/guard", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/lib/server/services/addressService", () => ({ getAddress: vi.fn(), updateAddress: vi.fn(), deleteAddress: vi.fn() }));

const DTO = {
  id: "64b7f0c2a1b2c3d4e5f60718", label: "home", recipientName: "علی", phone: "0912", province: "تهران", city: "تهران",
  district: null, neighborhood: null, street: null, alley: null, plaque: null, unit: null,
  addressLine: "x", postalCode: null, location: { latitude: 35.7, longitude: 51.4 },
  deliveryNotes: null, resolvedBy: null, isDefault: false,
};

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string) => GET(new NextRequest(`http://localhost/api/v1/addresses/${id}`), ctx(id));
const patch = (id: string, body: unknown) =>
  PATCH(new NextRequest(`http://localhost/api/v1/addresses/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx(id));
const del = (id: string) => DELETE(new NextRequest(`http://localhost/api/v1/addresses/${id}`, { method: "DELETE" }), ctx(id));

describe("/api/v1/addresses/[id]", () => {
  let requireAuth: ReturnType<typeof vi.fn>;
  let getAddress: ReturnType<typeof vi.fn>;
  let updateAddress: ReturnType<typeof vi.fn>;
  let deleteAddress: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    ({ requireAuth } = (await import("@/lib/server/auth/guard")) as unknown as { requireAuth: typeof requireAuth });
    ({ getAddress, updateAddress, deleteAddress } = (await import("@/lib/server/services/addressService")) as unknown as {
      getAddress: typeof getAddress; updateAddress: typeof updateAddress; deleteAddress: typeof deleteAddress;
    });
    requireAuth.mockReturnValue({ userId: "u1", role: "customer" });
    getAddress.mockResolvedValue(DTO);
    updateAddress.mockResolvedValue({ ...DTO, addressLine: "new" });
    deleteAddress.mockResolvedValue(undefined);
  });
  afterEach(() => vi.clearAllMocks());

  describe("GET", () => {
    it("requires authentication", async () => {
      requireAuth.mockImplementation(() => { throw AppError.unauthorized("x", "UNAUTHENTICATED"); });
      expect((await get(DTO.id)).status).toBe(401);
      expect(getAddress).not.toHaveBeenCalled();
    });

    it("returns the address, scoped by the authenticated user, not a client-supplied id", async () => {
      const res = await get(DTO.id);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data).toEqual(DTO);
      expect(getAddress).toHaveBeenCalledWith("u1", DTO.id);
    });

    it("another user's address (or a nonexistent one) is a 404, via the service's ownership check", async () => {
      getAddress.mockRejectedValue(AppError.notFound("آدرس یافت نشد", "ADDRESS_NOT_FOUND"));
      const res = await get("64b7f0c2a1b2c3d4e5f60719");
      const body = await res.json();
      expect(res.status).toBe(404);
      expect(body.error.code).toBe("ADDRESS_NOT_FOUND");
    });
  });

  describe("PATCH", () => {
    it("requires authentication", async () => {
      requireAuth.mockImplementation(() => { throw AppError.unauthorized("x", "UNAUTHENTICATED"); });
      expect((await patch(DTO.id, { addressLine: "x" })).status).toBe(401);
      expect(updateAddress).not.toHaveBeenCalled();
    });

    it("updates the address for the authenticated user", async () => {
      const res = await patch(DTO.id, { addressLine: "new" });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data.addressLine).toBe("new");
      expect(updateAddress).toHaveBeenCalledWith("u1", DTO.id, { addressLine: "new" });
    });

    it("rejects invalid coordinates in a partial update", async () => {
      const res = await patch(DTO.id, { location: { latitude: 999, longitude: 0 } });
      expect(res.status).toBe(400);
      expect(updateAddress).not.toHaveBeenCalled();
    });

    it("cannot update another user's address — service 404 is passed straight through", async () => {
      updateAddress.mockRejectedValue(AppError.notFound("آدرس یافت نشد", "ADDRESS_NOT_FOUND"));
      const res = await patch("64b7f0c2a1b2c3d4e5f60719", { addressLine: "hacked" });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE", () => {
    it("requires authentication", async () => {
      requireAuth.mockImplementation(() => { throw AppError.unauthorized("x", "UNAUTHENTICATED"); });
      expect((await del(DTO.id)).status).toBe(401);
      expect(deleteAddress).not.toHaveBeenCalled();
    });

    it("deletes the address for the authenticated user", async () => {
      const res = await del(DTO.id);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(deleteAddress).toHaveBeenCalledWith("u1", DTO.id);
    });

    it("cannot delete another user's address", async () => {
      deleteAddress.mockRejectedValue(AppError.notFound("آدرس یافت نشد", "ADDRESS_NOT_FOUND"));
      expect((await del("64b7f0c2a1b2c3d4e5f60719")).status).toBe(404);
    });
  });
});
