import { z } from "zod";

/**
 * Central, validated access to environment variables. Import `env` instead
 * of reading `process.env` directly anywhere in server code, so a missing
 * or malformed variable fails fast and loudly at startup instead of causing
 * a confusing runtime error deep inside a request handler.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),

  // --- Auth (see docs/auth.md for the full architecture write-up) ---
  JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET is required"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET is required"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN_DAYS: z.coerce.number().int().positive().default(30),

  OTP_LENGTH: z.coerce.number().int().positive().default(4),
  OTP_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(120),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  OTP_MAX_REQUESTS_PER_HOUR: z.coerce.number().int().positive().default(5),
  OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_LOCK_MINUTES_AFTER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(15),

  PASSWORD_HASH_ROUNDS: z.coerce.number().int().positive().default(10),
  PASSWORD_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
  PASSWORD_LOCK_MINUTES: z.coerce.number().int().positive().default(15),

  /**
   * Real SMS provider not chosen/configured yet (external service — see
   * MASTER-PROMPT.md §19). "console" is a dev/test-only fake that logs the
   * code instead of sending it; getEnv() below refuses to start with it in
   * production so an OTP code can never end up in a production log.
   */
  SMS_PROVIDER: z.preprocess(
    // Vercel value may be written "smsir", "sms.ir" or "sms_ir" — all mean the same provider.
    (v) => (typeof v === "string" ? v.trim().toLowerCase().replace(/[^a-z]/g, "") : v),
    z.enum(["console", "smsir"]).default("console"),
  ),
  /** sms.ir Verify (template) API — required only when SMS_PROVIDER=smsir. */
  SMS_IR_API_KEY: z.string().min(1).optional(),
  SMS_IR_TEMPLATE_ID: z.coerce.number().int().positive().optional(),

  // --- Maps (Phase 4.5 — see docs/maps.md). Only the config layer for provider
  // *selection*; MAP_MAX_RETRIES/MAP_CACHE_*/MAP_ENABLE_COMPARISON/
  // MAP_FALLBACK_PROVIDER are MapService concerns (Phase 8+), not validated here yet. ---
  /** Active service provider. Invalid values fail startup — never silently fall back to another provider. */
  MAP_PROVIDER: z.enum(["neshan", "mapir", "google"]).default("neshan"),
  /** Per-provider server credentials. Each is required only once its provider is actually resolved (see maps/registry.ts) — an unused provider's missing key must not block startup. */
  NESHAN_API_KEY: z.string().min(1).optional(),
  MAPIR_API_KEY: z.string().min(1).optional(),
  GOOGLE_MAPS_API_KEY: z.string().min(1).optional(),
  MAP_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
}).superRefine((env, ctx) => {
  if (env.SMS_PROVIDER === "smsir") {
    if (!env.SMS_IR_API_KEY) ctx.addIssue({ code: "custom", path: ["SMS_IR_API_KEY"], message: "required when SMS_PROVIDER=smsir" });
    if (!env.SMS_IR_TEMPLATE_ID) ctx.addIssue({ code: "custom", path: ["SMS_IR_TEMPLATE_ID"], message: "required when SMS_PROVIDER=smsir" });
  }
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.SMS_PROVIDER === "console") {
    throw new Error(
      "SMS_PROVIDER=console (dev/test-only, logs OTP codes) must not be used in production. " +
        "Configure a real SMS provider before deploying.",
    );
  }
  cached = parsed.data;
  return cached;
}
