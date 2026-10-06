import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, apiFetchPage, ApiClientError } from "./apiClient";

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

const success = <T>(data: T) => ({ success: true, data, message: null, pagination: null, error: null });
const failure = (code: string, message = "err") => ({
  success: false,
  data: null,
  message: null,
  pagination: null,
  error: { code, message },
});

describe("apiFetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns data on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(success({ hello: "world" }))));
    const data = await apiFetch<{ hello: string }>("/some/path");
    expect(data).toEqual({ hello: "world" });
  });

  it("throws ApiClientError on a non-auth failure without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(failure("VALIDATION_ERROR", "bad input"), 400));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/some/path")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("on 401 INVALID_ACCESS_TOKEN, refreshes once and retries the original request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(failure("INVALID_ACCESS_TOKEN"), 401)) // original call
      .mockResolvedValueOnce(jsonResponse(success({ ok: true }), 200)) // /auth/refresh
      .mockResolvedValueOnce(jsonResponse(success({ ok: true }), 200)); // retried original call
    vi.stubGlobal("fetch", fetchMock);

    const data = await apiFetch<{ ok: boolean }>("/protected/thing");
    expect(data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/auth/refresh");
  });

  it("propagates the original 401 when refresh itself fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(failure("INVALID_ACCESS_TOKEN"), 401))
      .mockResolvedValueOnce(jsonResponse(failure("INVALID_REFRESH_TOKEN"), 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/protected/thing")).rejects.toBeInstanceOf(ApiClientError);
    expect(fetchMock).toHaveBeenCalledTimes(2); // original + refresh attempt, no third retry
  });

  it("does not attempt to refresh for auth endpoints themselves", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(failure("INVALID_CREDENTIALS"), 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/auth/login/password", { method: "POST", body: {} })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("de-duplicates concurrent refreshes into a single /auth/refresh call", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(failure("INVALID_ACCESS_TOKEN"), 401)) // request A
      .mockResolvedValueOnce(jsonResponse(failure("INVALID_ACCESS_TOKEN"), 401)) // request B
      .mockResolvedValueOnce(jsonResponse(success({ ok: true }), 200)) // the single /auth/refresh
      .mockResolvedValueOnce(jsonResponse(success({ a: true }), 200)) // retried A
      .mockResolvedValueOnce(jsonResponse(success({ b: true }), 200)); // retried B
    vi.stubGlobal("fetch", fetchMock);

    const [a, b] = await Promise.all([apiFetch("/a"), apiFetch("/b")]);
    expect(a).toEqual({ a: true });
    expect(b).toEqual({ b: true });
    const refreshCalls = fetchMock.mock.calls.filter((c) => c[0] === "/api/v1/auth/refresh");
    expect(refreshCalls).toHaveLength(1);
  });
});

describe("apiFetchPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns data together with the envelope pagination", async () => {
    const env = { ...success([1, 2]), pagination: { page: 2, pageSize: 20, total: 45 } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(env)));
    expect(await apiFetchPage<number[]>("/list?page=2")).toEqual({ data: [1, 2], pagination: { page: 2, pageSize: 20, total: 45 } });
  });

  it("throws ApiClientError on failure and when the server sends no pagination", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(failure("FORBIDDEN_ROLE"), 403)));
    await expect(apiFetchPage("/list")).rejects.toMatchObject({ status: 403, code: "FORBIDDEN_ROLE" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(success([]))));
    await expect(apiFetchPage("/list")).rejects.toBeInstanceOf(ApiClientError);
  });
});
