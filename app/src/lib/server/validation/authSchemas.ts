import { z } from "zod";

/**
 * Phone format itself is NOT validated here with a regex — normalizeIranMobile()
 * in the service layer is the single source of truth for that (see
 * packages/shared/src/phone.ts) so the rule is never duplicated/out of sync.
 * Zod's job here is just structural: is it a non-empty string at all.
 */
const phone = z.string().min(1, "شماره موبایل الزامی است");

export const requestOtpSchema = z.object({ phone });

export const verifyOtpSchema = z.object({
  phone,
  code: z.string().min(1, "کد الزامی است"),
});

export const adminPasswordLoginSchema = z.object({
  phone,
  password: z.string().min(1, "رمز عبور الزامی است"),
});

export const passwordResetConfirmSchema = z.object({
  phone,
  code: z.string().min(1, "کد الزامی است"),
  newPassword: z.string().min(8, "رمز عبور باید حداقل ۸ نویسه باشد"),
});
