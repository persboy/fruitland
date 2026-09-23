import { afterEach, describe, expect, it, vi } from "vitest";
import { SmsIrProvider } from "./SmsIrProvider";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("SmsIrProvider", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts a Verify request with the Code parameter and API key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ status: 1, message: "موفق" }));
    vi.stubGlobal("fetch", fetchMock);
    await new SmsIrProvider("secret-key", 777).sendOtp("09120000000", "1234");

    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://api.sms.ir/v1/send/verify");
    expect(init.headers["X-API-KEY"]).toBe("secret-key");
    expect(JSON.parse(init.body)).toEqual({
      mobile: "09120000000",
      templateId: 777,
      parameters: [{ name: "Code", value: "1234" }],
    });
  });

  it("fails when sms.ir answers HTTP 200 with status != 1", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ status: 101, message: "err" })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(new SmsIrProvider("k", 1).sendOtp("09120000000", "1234")).rejects.toMatchObject({ code: "SMS_SEND_FAILED" });
  });

  it("fails on network errors and never leaks the OTP code or key into the error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    const err = await new SmsIrProvider("secret-key", 1).sendOtp("09120000000", "4321").catch((e: Error) => e);
    expect(err).toMatchObject({ code: "SMS_SEND_FAILED" });
    expect((err as Error).message).not.toMatch(/4321|secret-key/);
  });
});
