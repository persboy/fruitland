import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { Otp } from "./Otp";
import { RefreshToken } from "./RefreshToken";

describe("Otp schema", () => {
  it("requires codeHash and expiresAt", () => {
    const doc = new Otp({ phone: "09120000000" });
    const err = doc.validateSync();
    expect(err?.errors.codeHash).toBeDefined();
    expect(err?.errors.expiresAt).toBeDefined();
  });

  it("rejects an unknown purpose", () => {
    const doc = new Otp({
      phone: "09120000000",
      purpose: "vibe_check",
      codeHash: "x",
      expiresAt: new Date(),
    });
    const err = doc.validateSync();
    expect(err?.errors.purpose).toBeDefined();
  });

  it("defaults purpose to login", () => {
    const doc = new Otp({ phone: "09120000000", codeHash: "x", expiresAt: new Date() });
    expect(doc.purpose).toBe("login");
    expect(doc.validateSync()).toBeUndefined();
  });
});

describe("RefreshToken schema", () => {
  it("requires userId, jti, tokenHash and expiresAt", () => {
    const doc = new RefreshToken({});
    const err = doc.validateSync();
    expect(err?.errors.userId).toBeDefined();
    expect(err?.errors.jti).toBeDefined();
    expect(err?.errors.tokenHash).toBeDefined();
    expect(err?.errors.expiresAt).toBeDefined();
  });

  it("accepts a valid session record", () => {
    const doc = new RefreshToken({
      userId: new Types.ObjectId(),
      jti: crypto.randomUUID(),
      tokenHash: "hashed",
      expiresAt: new Date(Date.now() + 1000),
      userAgent: "Mozilla/5.0",
      ip: "127.0.0.1",
    });
    expect(doc.validateSync()).toBeUndefined();
  });
});
