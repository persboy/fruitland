import { z } from "zod";

const phone = z.string().min(1, "شماره موبایل الزامی است");

/** Empty string is allowed (clears the name); the service stores trimmed values. */
const namePart = z.string().trim().max(50, "نام و نام‌خانوادگی حداکثر ۵۰ نویسه باشد");

export const updateProfileSchema = z.object({
  firstName: namePart,
  lastName: namePart,
});

export const requestPhoneChangeSchema = z.object({ newPhone: phone });

export const confirmPhoneChangeSchema = z.object({
  newPhone: phone,
  code: z.string().min(1, "کد الزامی است"),
});

export const changePasswordSchema = z.object({
  /** Required by the service whenever the account already has a password; ignored otherwise. */
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, "رمز عبور باید حداقل ۸ نویسه باشد").max(128, "رمز عبور حداکثر ۱۲۸ نویسه باشد"),
});

export const storeSettingsSchema = z.object({
  storeName: z.string().trim().min(1, "نام فروشگاه الزامی است").max(100, "نام فروشگاه حداکثر ۱۰۰ نویسه باشد"),
  supportPhone: z.string().trim().min(1, "شماره پشتیبانی الزامی است").max(30, "شماره پشتیبانی حداکثر ۳۰ نویسه باشد"),
  address: z.string().trim().max(300, "آدرس حداکثر ۳۰۰ نویسه باشد"),
});

const toman = (label: string) =>
  z
    .number({ invalid_type_error: `${label} باید عدد باشد`, required_error: `${label} الزامی است` })
    .int(`${label} باید عدد صحیح (تومان) باشد`)
    .min(0, `${label} نمی‌تواند منفی باشد`)
    .max(Number.MAX_SAFE_INTEGER, `${label} بیش از حد بزرگ است`);

export const shippingSettingsSchema = z.object({
  expressDeliveryFee: toman("هزینه ارسال فوری"),
  freeDeliveryThreshold: toman("حداقل مبلغ ارسال رایگان"),
});
