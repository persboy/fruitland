# CLAUDE.md — Persboy (fruitland)

این فایل حافظه‌ی عملیاتی پروژه است. فقط شامل چیزهایی است که واقعاً پیاده‌سازی و تأیید شده‌اند.

## وضعیت فعلی

- **فاز:** Phase 3 — Application Foundation (بخش «پایه‌ی احراز هویت» کامل شد؛ routing/layouts/UI system/API client هنوز باقی مانده)
- **معماری تأییدشده:** یک اپ Next.js واحد (storefront + admin + courier + API Routes)، **نه** بک‌اند Express جدا. تصمیم کاربر، ثبت‌شده.
- **معماری احراز هویت تأییدشده:** جزئیات کامل در `docs/auth.md`. خلاصه: OTP برای customer/courier، رمز عبور برای admin/master_admin، JWT access(۱۵m)+refresh(۳۰day, rotating)، اولین کاربر کل سیستم اتمیک MASTER_ADMIN می‌شود.
- **ریپوی Legacy:** `persboy/fruit-veg-store-backend` — فقط رفرنس، read-only. یک اپ Next.js مونولیتیک با ۱۴۳ روت API، شامل Auth/Wallet/Referral/Discount/Orders/Reviews پیاده‌سازی‌شده. README آن قدیمی و گمراه‌کننده است (می‌گوید فاز ۱ Mock‌محور، ولی کد واقعی و متصل به DB است).

## ساختار Monorepo

```
/
├── app/                          @fruitland/app — اپ Next.js 16 (App Router)
│   ├── src/app/
│   │   ├── layout.tsx (RTL/fa)، page.tsx (اسکلت موقت)
│   │   └── api/v1/health, api/v1/auth/*        ۱۱ روت auth (پایین را ببینید)
│   └── src/lib/server/
│       ├── env.ts, db.ts, apiResponse.ts   (Phase 1، env.ts حالا شامل تنظیمات auth هم هست)
│       ├── errors/AppError.ts
│       ├── models/                          ۱۸ مدل Mongoose (User+Category+...، + Otp + RefreshToken)
│       ├── auth/                            password.ts, jwt.ts, cookies.ts, guard.ts, device.ts
│       ├── services/                        otpService.ts, authService.ts, sms/ (adapter)
│       └── validation/                      authSchemas.ts (Zod)، parseJsonBody.ts
├── packages/shared/              @fruitland/shared — money.ts، jalali.ts، phone.ts، domain/enums.ts
├── docs/domain-model.md          تحلیل کامل دامنه (Phase 2)
├── docs/auth.md                  معماری کامل احراز هویت (Phase 3)
├── e2e/                          Playwright (smoke.spec.ts)
├── playwright.config.ts
└── package.json                  npm workspaces: app, packages/*
```

## استک تأییدشده

Next.js 16.3.5، React 19، TypeScript 5.7 (strict)، Tailwind CSS v4، Zod، Mongoose 8، bcryptjs، jsonwebtoken، ESLint 9 (flat config native از `eslint-config-next`)، Vitest 2، Playwright 1.55، mongodb-memory-server 10 (فقط برای `test:integration`، پایین را ببینید).

## چیزهایی که واقعاً تست و تأیید شدند

- `npm install` روی کل مونوریپو — موفق.
- `npm run typecheck` در هر دو workspace (`app`, `@fruitland/shared`) — بدون خطا.
- `npm run lint` (ESLint) در `app` — بدون خطا و بدون warning.
- تست‌های واحد (Vitest):
  - `packages/shared`: ۵۱ تست (money.ts، jalali.ts، phone.ts، domain/enums.ts) — پاس.
  - `app`: ۶۷ تست (apiResponse/AppError، env validation، ۱۸ مدل Mongoose، password.ts، jwt.ts) — پاس.
- `npm run build --workspace=app` (Turbopack) — موفق؛ شامل ۱۱ روت auth + `/`, `/_not-found`, `/api/v1/health`.
- اجرای واقعی سرور production (`next start`) و تست دستی:
  - `GET /` → HTML صحیح با `lang="fa" dir="rtl"` و محتوای فارسی.
  - `GET /api/v1/health` → envelope استاندارد برگرداند (چون در محیط sandbox، MongoDB واقعی در دسترس نبود، پاسخ `error.code=HEALTH_CHECK_FAILED` بود — این رفتار **درست** است، نه باگ؛ envelope شکست را هم به‌درستی برمی‌گرداند).

## Phase 2 — مدل دامنه (کامل شد)

تحلیل کامل در `docs/domain-model.md` است (موجودیت‌ها، روابط، ماشین‌حالت، ایندکس، ۱۰ تصمیم کلیدی با استدلال، سؤالات باز). خلاصه‌ی پیاده‌سازی:

- **enumهای مشترک:** `packages/shared/src/domain/enums.ts` — تک‌منبع حقیقت برای role، وضعیت سفارش، نوع تخفیف، واحد محصول و... . مدل‌های Mongoose و (در آینده) UI هر دو از همین‌جا import می‌کنند.
- **۱۶ مدل Mongoose** در `app/src/lib/server/models/`: User (با Address و CourierProfile Embedded)، SystemState، Category، Product (با ProductVariant Embedded)، Order (با OrderItem/OrderDelivery/آدرس Snapshot Embedded)، OrderCounter، DiscountCode، Review، ReviewAttribute، Notification، AuditLog، StoreSettings، ShippingSettings، SiteContent، FaqItem، HomepageSlide.
- **عمداً از این فاز حذف شدند** (چون تأییدنشده‌اند، نه فراموش‌شده — `docs/domain-model.md` §۷): پرداخت آنلاین (`OrderPaymentSession`، `PhoneOrderPaymentLink`)، کیف‌پول (`Wallet*`)، تنظیمات رفرال (`ReferralSettings`)، OTP/RefreshToken (احراز هویت تأییدنشده).
- **تغییر آگاهانه نسبت به Legacy:** `Category` از enum ثابت به کالکشن واقعی تبدیل شد (نقشه‌ی راه صفحه‌ی مستقل «دسته‌بندی‌ها» در ادمین دارد)؛ `isOrganic` فقط صفت محصول ماند، نه دسته.
- در حین پیاده‌سازی دو مشکل فنی از فاز ۱ کشف و رفع شد (بدون تغییر رفتار قبلی):
  1. `packages/shared/src/jalali.ts`: ambient type declaration فایل `jalaali-js.d.ts` در تایپ‌چک `app` دیده نمی‌شد (چون هیچ‌کدام از فایل‌های Phase 1 واقعاً از `@fruitland/shared` استفاده نمی‌کردند تا این مشکل را آشکار کند). رفع شد با `/// <reference path="./jalaali-js.d.ts" />`.
  2. الگوی `models.X || model<T>(...)` باعث خطای تایپ در متدهای static (`create`, `findOneAndUpdate`) می‌شد؛ با cast صریح به `Model<T>` رفع شد.

### تست‌ها

- **۵۳ تست واحد Vitest** (`npm run test`) — بدون نیاز به DB واقعی؛ با `validateSync()` قوانین schema (required، enum، custom validator مثل «کد تخفیف شخصی نیاز به مالک دارد») تست شدند. همه پاس.
- **تست‌های یکپارچه‌ی واقعی نوشته شدند ولی در این sandbox اجرا نشدند:** `app/src/lib/server/models/persistence.integration.test.ts` (uniqueness واقعی روی User.phone/DiscountCode.code/Review compound index، atomic counter، race شرط MASTER_ADMIN) — نیاز به دانلود باینری MongoDB از `fastdl.mongodb.org` دارد که در allowlist شبکه‌ی این sandbox نیست (دقیقاً مثل محدودیت شناخته‌شده‌ی Playwright بالا). با `npm run test:integration` جدا از `npm run verify` نگه داشته شد تا pipeline اصلی را قفل نکند. **باید در محیط dev/CI واقعی با دسترسی شبکه اجرا و تأیید شود.**
- `npm run verify` (lint + typecheck + test + build) — همه پاس، شامل build واقعی Next.js.



## Phase 3 — پایه‌ی احراز هویت (کامل شد)

جزئیات کامل در `docs/auth.md`. خلاصه:

- **معماری تأییدشده توسط کاربر** (نه حدس زده‌شده)، مبتنی‌بر ارزیابی الگوی Legacy + دو تصمیم
  اضافه‌ی تأییدشده: بازیابی رمز ادمین از طریق OTP، و مدیریت نشست‌ها (لیست/ابطال دستگاه).
- **مدل‌های جدید:** `Otp` (یک رکورد فعال به‌ازای phone+purpose)، `RefreshToken` (یک سند =
  یک نشست/دستگاه — همین کالکشن خودِ «لیست دستگاه‌های فعال» است، بدون مدل جداگانه). فیلدهای
  رمز عبور (`passwordHash` و...، همه `select:false`) به `User` اضافه شد.
- **enum جدید:** `OTP_PURPOSES` در `packages/shared`. **util جدید:** `phone.ts`
  (نرمال‌سازی موبایل ایران، pure، مشترک بین کلاینت/سرور).
- **۱۱ Route Handler** زیر `/api/v1/auth/`: otp/request، otp/verify، login/password،
  password-reset/request، password-reset/confirm، refresh، logout، me، sessions (GET+DELETE)،
  sessions/[id] (DELETE).
- **آداپتور SMS:** `SmsProvider` interface + `ConsoleSmsProvider` (dev-only، کد را لاگ می‌کند).
  سرویس واقعی هنوز انتخاب نشده — `docs/auth.md` §۸. `getEnv()` اجرا در production با
  `SMS_PROVIDER=console` را رد می‌کند (جلوگیری از لو رفتن کد OTP در لاگ واقعی).
- **تصمیمات امنیتی کلیدی:** خطای عمومی یکسان برای ورود رمز ادمین (ضد شمارش)، Refresh Token
  Rotation با Reuse Detection (توکن سرقتی/تکراری → ابطال همه‌ی نشست‌ها)، تغییر رمز = ابطال
  خودکار همه‌ی نشست‌ها.

### تست‌ها

- **۶۷ تست واحد** (بدون DB، شامل ۱۰ تست جدید برای مدل‌های Otp/RefreshToken + password.ts +
  jwt.ts) — همه پاس.
- **تست‌های یکپارچه‌ی واقعی نوشته شدند** (`otpService.integration.test.ts`،
  `authService.integration.test.ts`) — پوشش کامل: ادعای MASTER_ADMIN، cooldown/سقف/قفل OTP،
  قفل رمز ادمین، rotation + reuse detection، logout تک‌دستگاهی، بازیابی رمز، no-op ضد-شمارش.
  **در این sandbox اجرا نشدند** (همان محدودیت دانلود باینری MongoDB — بخش محدودیت‌ها را
  ببینید)؛ باید در dev/CI واقعی با `npm run test:integration` تأیید شوند.
- `npm run verify` کامل (lint + typecheck + ۶۷ تست + build) — پاس.



## کارهای تأییدنشده / محدودیت شناخته‌شده

- **Playwright e2e اجرا نشد.** دانلود باینری مرورگر Chromium از `cdn.playwright.dev` در sandbox فعلی مسدود است (خارج از allowlist شبکه). فایل `e2e/smoke.spec.ts` نوشته شده ولی تا اجرای واقعی در محیط dev/CI با دسترسی شبکه کامل، «تست‌شده» تلقی نشود.
- **تست‌های یکپارچه‌ی مدل (`npm run test:integration`) اجرا نشدند.** همان محدودیت شبکه — دانلود باینری MongoDB از `fastdl.mongodb.org` مسدود است. فایل `persistence.integration.test.ts` (Phase 2) و `otpService.integration.test.ts`/`authService.integration.test.ts` (Phase 3) نوشته شده‌اند؛ باید در dev/CI واقعی اجرا و تأیید شوند.
- **سرویس SMS واقعی هنوز انتخاب نشده.** فقط `ConsoleSmsProvider` (dev-only) وجود دارد. جزئیات و راه اضافه‌کردن provider واقعی در `docs/auth.md` §۸.
- فونت فارسی (Vazirmatn) هنوز بارگذاری نشده؛ در globals.css فقط به‌عنوان fallback نام برده شده. این کار به فاز ۳ (Application Foundation / UI System) موکول شد.
- axe accessibility testing هنوز راه‌اندازی نشده.
- MongoDB واقعی برای dev/test در sandbox فعلی نصب نیست؛ اتصال فقط با کانفیگ صحیح تست شد، نه با DB واقعی در حال اجرا.

## قوانین محیطی

متغیرهای محیطی در `app/.env.example` مستند شده‌اند. الزامی در این مرحله: `MONGODB_URI`، `JWT_ACCESS_SECRET`، `JWT_REFRESH_SECRET`. بقیه (OTP/Password/SMS_PROVIDER) پیش‌فرض دارند. رمزها هرگز کامیت نشوند.

## نکته‌ی معماری برای جلسات آینده

هرگونه بک‌اند/سرویس جدید باید به‌صورت Next.js Route Handler زیر `app/src/app/api/v1/...` نوشته شود، با لایه‌بندی Route → Service → Model، و همیشه از پوشش پاسخ استاندارد (`app/src/lib/server/apiResponse.ts`) استفاده کند. هرگز الگوی Express را دوباره معرفی نکنید — این تصمیم توسط کاربر گرفته و ثبت شده است.

## مرحله‌ی بعد

بخش «پایه‌ی احراز هویت» از Phase 3 کامل شد. باقیمانده‌ی Phase 3: routing/layouts، UI system،
API client سمت فرانت، error/loading states، shared components — سپس شروع صفحات واقعی طبق
نقشه‌ی راه (Phase 4 Admin، شروع با «Authentication» یعنی صفحه‌ی ورود واقعی که از همین
API استفاده می‌کند).

- در محیط dev/CI با دسترسی شبکه‌ی کامل: `npm run test:integration` و `npm run test:e2e` را اجرا و نتیجه را در این فایل ثبت کنید.
- انتخاب سرویس واقعی SMS قبل از استقرار production لازم است (`docs/auth.md` §۸).
