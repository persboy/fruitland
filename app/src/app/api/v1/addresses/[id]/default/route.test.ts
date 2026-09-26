import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/server/errors/AppError";
import { POST } from "./route";

vi.mock("@/lib/server/auth/guard", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ connectToDatabase: vi.fn() }));
vi.mock("@/lib/server/services/addressService", () => ({ setDefaultAddress: vi.fn() }));

const DTO = { id: "64b7f0c2a1b2c3d4e5f60718", isDefault: true };
const post = (id: string) =>
  POST(new NextRequest(`http://localhost/api/v1/addresses/${id}/default`, { method: "POST" }), { params: Promise.resolve({ id }) });

describe("POST /api/v1/addresses/[id]/default", () => {
  let requireAuth: ReturnType<typeof vi.fn>;
  let setDefaultAddress: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    ({ requireAuth } = (await import("@/lib/server/auth/guard")) as unknown as { requireAuth: typeof requireAuth });
    ({ setDefaultAddress } = (await import("@/lib/server/services/addressService")) as unknown as { setDefaultAddress: typeof setDefaultAddress });
    requireAuth.mockReturnValue({ userId: "u1", role: "customer" });
    setDefaultAddress.mockResolvedValue(DTO);
  });
  afterEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    requireAuth.mockImplementation(() => { throw AppError.unauthorized("x", "UNAUTHENTICATED"); });
    expect((await post(DTO.id)).status).toBe(401);
    expect(setDefaultAddress).not.toHaveBeenCalled();
  });

  it("sets the default for the authenticated user's own address", async () => {
    const res = await post(DTO.id);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.isDefault).toBe(true);
    expect(setDefaultAddress).toHaveBeenCalledWith("u1", DTO.id);
  });

  it("cannot set another user's address as default", async () => {
    setDefaultAddress.mockRejectedValue(AppError.notFound("آدرس یافت نشد", "ADDRESS_NOT_FOUND"));
    expect((await post("64b7f0c2a1b2c3d4e5f60719")).status).toBe(404);
  });
});
