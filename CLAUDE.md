# CLAUDE.md — Persboy (fruitland)

این فایل حافظه‌ی عملیاتی پروژه است. فقط شامل چیزهایی است که واقعاً پیاده‌سازی و تأیید شده‌اند.

## وضعیت فعلی

- **فاز:** Phase 4 — Admin — صفحه‌ی ۱ (Authentication) تأیید شد؛ صفحه‌ی ۲ (Settings) پیاده‌سازی شد، منتظر تأیید کاربر. بعدی پس از تأیید: صفحه‌ی ۳ Categories
- **معماری تأییدشده:** یک اپ Next.js واحد (storefront + admin + courier + API Routes)، **نه** بک‌اند Express جدا. تصمیم کاربر، ثبت‌شده.
- **مسیرها:** storefront در `app/src/app/(storefront)/` (بدون پیشوند URL، فقط برای سازمان‌دهی کد)، ادمین زیر `/admin`، پیک زیر `/courier` — هرکدام layout جدای خودشان.
- **معماری احراز هویت تأییدشده:** جزئیات کامل در `docs/auth.md`. خلاصه: OTP برای customer/courier، رمز عبور برای admin/master_admin، JWT access(۱۵m)+refresh(۳۰day, rotating)، اولین کاربر کل سیستم اتمیک MASTER_ADMIN می‌شود.
- **ریپوی Legacy:** `persboy/fruit-veg-store-backend` — فقط رفرنس، read-only. یک اپ Next.js مونولیتیک با ۱۴۳ روت API، شامل Auth/Wallet/Referral/Discount/Orders/Reviews پیاده‌سازی‌شده. README آن قدیمی و گمراه‌کننده است (می‌گوید فاز ۱ Mock‌محور، ولی کد واقعی و متصل به DB است).

## ساختار Monorepo

```
/
├── app/                          @fruitland/app — اپ Next.js 16 (App Router)
│   ├── src/app/fonts/iranyekanx/  IRANYekanX (۵ وزن woff2 + FontLicense.txt) — همان فونت پروژه‌ی Legacy، از طریق next/font/local
│   ├── src/app/
│   │   ├── layout.tsx (فقط html/body/fonts)، not-found.tsx، global-error.tsx
│   │   ├── (storefront)/          layout.tsx (شل موبایل)، page.tsx، loading.tsx، error.tsx
│   │   ├── admin/                 error.tsx، login/ (صفحه‌ی ورود)، (panel)/ (layout=AdminShell، page.tsx=میز کار)
│   │   ├── courier/               layout.tsx (شل موبایل)، loading.tsx، error.tsx — هنوز page.tsx ندارد (Phase 5)
│   │   └── api/v1/health, api/v1/auth/*        ۱۱ روت auth
│   ├── src/components/ui/         Button, Input, Card, Spinner, Skeleton, StateMessage (§۲۱ همه‌ی state ها)
│   ├── src/lib/cn.ts               clsx+tailwind-merge combiner
│   ├── src/lib/client/apiClient.ts  fetch wrapper سمت کلاینت (envelope-aware، auto-refresh روی ۴۰۱)
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
  - `app`: ۷۳ تست (apiResponse/AppError، env validation، ۱۸ مدل Mongoose، password.ts، jwt.ts، apiClient.ts) — پاس.
- `npm run build --workspace=app` (Turbopack) — موفق؛ شامل ۱۱ روت auth + `/`, `/_not-found`, `/api/v1/health`. `/admin` و `/courier` هنوز روت تولید نمی‌کنند چون page.tsx ندارند (عمدی — Phase 4/5).
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



## Phase 3 — Application Foundation (کامل شد)

### بخش ۱: پایه‌ی احراز هویت

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

### بخش ۲: Routing، UI System، API Client

- **طرح بصری (طبق دستور کاربر: عیناً از پروژه‌ی Legacy):** پالت پیش‌فرض Tailwind — emerald (`emerald-500/600`)
  رنگ اصلی، gray برای خنثی‌ها، red برای خطا/حذف؛ پس‌زمینه‌ی `#F7F9F8`؛ کارت‌ها `rounded-2xl border-gray-100
  shadow-sm`؛ ورودی/دکمه‌ی اصلی به‌شکل pill؛ فونت **IRANYekanX** (`--font-iranyekanx`، `font-sans`). هیچ توکن
  رنگ سفارشی وجود ندارد (طرح «کرم/سبز برگی/نارنجی» و Vazirmatn قبلی حذف شد). فقط فواصل غیراستاندارد Legacy به
  مقادیر استاندارد Tailwind تبدیل می‌شوند. ⚠️ فونت مالکیتی است: کد لایسنس ۶ رقمی باید در
  `app/src/app/fonts/iranyekanx/FontLicense.txt` درج شود (ریپو private است).
- **Routing:** استفاده از Route Group `(storefront)` (بدون تأثیر در URL، فقط سازمان‌دهی)
  + پوشه‌های واقعی `admin/` و `courier/` (چون این‌ها به پیشوند URL واقعی نیاز دارند). هر سه
  layout جدای خودشان را دارند (استوِرفرانت/پیک: موبایل و max-width محدود؛ ادمین: تمام‌عرض
  دسکتاپ، طبق §۱۰ Master Prompt). `admin/` و `courier/` عمداً هنوز `page.tsx` ندارند —
  فقط لایه‌ی layout/loading/error پایه، بدون هیچ لینک مرده یا placeholder جعلی (§۳۸).
- **کامپوننت‌های مشترک** (`src/components/ui/`): `Button`، `Input`، `Card`، `Spinner`،
  `Skeleton`، `StateMessage` (یک کامپوننت عمومی برای همه‌ی حالت‌های empty/error/۴۰۴/network
  به‌جای تکرار — طبق §۲۱ همه‌ی state های لازم پوشش داده شدند: loading/empty/error/not-found).
  Focus ring قابل‌مشاهده سراسری در `globals.css` (§۲۸ دسترس‌پذیری).
- **API Client سمت کلاینت** (`src/lib/client/apiClient.ts`): fetch wrapper آگاه از envelope
  استاندارد سرور، خطاها را به `ApiClientError` تبدیل می‌کند، و روی خطای `۴۰۱` (انقضای Access
  Token) به‌طور خودکار یک‌بار `refresh` می‌زند و درخواست را تکرار می‌کند — با de-duplication
  برای درخواست‌های هم‌زمان (یک refresh مشترک، نه چندتا).
- **صفحه‌ی اصلی storefront** بازنویسی شد با کامپوننت‌های جدید — همچنان محتوای صادقانه‌ی
  «در حال ساخت» دارد (نه داده‌ی جعلی محصول، طبق §۲۲).

### تست‌ها

- **۷۳ تست واحد** (۶ تست جدید برای `apiClient.ts` با mock کردن `fetch` — پوشش: موفقیت،
  خطای بدون auth، refresh-and-retry روی ۴۰۱، شکست refresh، عدم retry برای خود auth
  endpointها، de-duplication چند درخواست هم‌زمان) — همه پاس.
- **تست‌های یکپارچه‌ی واقعی نوشته شدند** (`otpService.integration.test.ts`،
  `authService.integration.test.ts`) — پوشش کامل: ادعای MASTER_ADMIN، cooldown/سقف/قفل OTP،
  قفل رمز ادمین، rotation + reuse detection، logout تک‌دستگاهی، بازیابی رمز، no-op ضد-شمارش.
  **در این sandbox اجرا نشدند** (همان محدودیت دانلود باینری MongoDB — بخش محدودیت‌ها را
  ببینید)؛ باید در dev/CI واقعی با `npm run test:integration` تأیید شوند.
- `npm run verify` کامل (lint + typecheck + ۷۳ تست + build) — پاس.
- **بررسی بصری واقعی (screenshot) انجام نشد** — این sandbox مرورگر/ابزار رندر تصویری ندارد
  (همان محدودیت Playwright). طراحی فقط از طریق مرور کد و موفقیت build/typecheck تأیید شد؛
  طبق §۲۴ Master Prompt («بازرسی واقعی UI»)، باید در محیط dev واقعی با چشم بررسی شود — به‌خصوص
  در ۳۷۵px/۷۶۸px/۱۲۸۰px طبق پروتکل صفحه.




## Phase 4 — Admin

### صفحه‌ی ۱: Authentication (تأیید‌شده توسط کاربر)

- **ظاهر:** کپی وفادار `AdminLoginClient`/`AdminShell`/`AdminSidebar`/`AdminTopbar` پروژه‌ی Legacy (کارت مرکزی، دو تب «رمز عبور» / «کد پیامکی»، ورودی‌های pill با آیکون، دکمه‌ی emerald، سایدبار راست با برند و کارت ادمین، تاپ‌بار شیشه‌ای).
  **عمداً حذف‌شده نسبت به Legacy (چون هنوز پشتشان قابلیت واقعی نیست، §۳۸/§۲۲):** نوار جستجو، زنگ اعلان، لینک «تنظیمات» و آیتم‌های منو به صفحات ناساخته. هر صفحه‌ی Phase 4 آیتم منوی خودش را هنگام ساخته‌شدن اضافه می‌کند.
- **مسیرها:** `/admin/login` (پشتیبانی از `?returnTo=` فقط برای مسیرهای `/admin`)، `/admin` (میز کار؛ فعلاً فقط پیام ورود موفق، بدون آمار جعلی). صفحات زیر `admin/(panel)/` خودکار پشت `AdminShell` (گیت سمت کلاینت با `/auth/me`؛ مرجع اصلی همچنان API) هستند.
- **جریان‌ها:** ورود با رمز؛ ورود با کد پیامکی (همان `/auth/otp/*`). **اولین مستر ادمین** با تب «کد پیامکی» ساخته می‌شود (اولین OTP سیستم اتمیک MASTER_ADMIN می‌شود) و بعداً از «تنظیمات» (صفحه‌ی ۲) رمز می‌گذارد — مثل Legacy. شماره‌ای که ادمین نیست بعد از OTP بلافاصله logout و با پیام «این شماره دسترسی مدیریتی ندارد» رد می‌شود.
- **بک‌اند جدید:** `SmsIrProvider` (جزئیات در `docs/auth.md` §۹). endpoint های `setup-status`/`password/setup` که در نسخه‌ی اولیه نوشته شده بودند حذف شدند (با ظاهر Legacy لازم نیستند).
- **تست:** `npm run verify` پاس؛ ۹۰ تست واحد در app (شامل ۱۰ تست جریان ورود، ۳ SmsIrProvider، ۲ env، ۲ گروه helper).
- **اجرا نشده (محدودیت sandbox):** بررسی بصری/اسکرین‌شات ۳۷۵/۷۶۸/۱۲۸۰px (مرورگر در دسترس نیست — ظاهر با Legacy مقایسه‌ی کدی شده، نه بصری)، axe (کنتراست `text-gray-400` روی سفید Legacy احتمالاً زیر ۴.۵:۱ است؛ رنگ عیناً حفظ شد)، E2E، تست‌های یکپارچه‌ی DB، ارسال واقعی sms.ir.

### صفحه‌ی ۲: Settings (پیاده‌سازی شد؛ منتظر تأیید کاربر)

- **مسیر:** `/admin/settings` (منوی کناری «تنظیمات»؛ زیر `(panel)` پس گارد ورود دارد). چهار کارت با ظاهر Legacy (حالت نمایش/ویرایش): **پروفایل من**، **اطلاعات فروشگاه**، **تنظیمات ارسال**، **روش‌های پرداخت** (فقط COD، فقط‌نمایشی).
- **تصمیم‌های کاربر:** (۱) تغییر شماره‌ی موبایل ادمین **با OTP روی شماره‌ی جدید** (برخلاف Legacy که بدون OTP بود). (۲) کارت «اعضای تیم و دسترسی‌ها» در Settings **نیست** — بعداً صفحه‌ی جدا.
- **خارج از این صفحه (عمداً):** کیف پول، رفرال (فرمول تصمیم‌گیری نشده)، اعلان‌ها، `socialLinks` (متعلق به صفحه‌ی «محتوای سایت»). توضیح/ایمیل فروشگاه و «آدرس ساخت‌یافته» Legacy هم نیست چون در مدل دامنه‌ی جدید (`StoreSettings`) وجود ندارد.
- **API (همه فقط admin/master_admin؛ ترتیب: auth → validation → DB):**
  `PATCH /admin/profile` (نام)، `POST /admin/profile/phone/request` + `/phone/confirm`، `POST /admin/profile/password`
  (رمز فعلی فقط وقتی رمزی وجود دارد لازم است؛ حدس اشتباه به همان شمارنده‌ی قفل ورود می‌رود)،
  `GET/PUT /admin/settings/store`، `GET/PUT /admin/settings/shipping`. `GET /auth/me` فیلد `hasPassword` هم برمی‌گرداند.
- **یک منبع حقیقت ارسال:** `ShippingSettings` (singleton) — `expressDeliveryFee` و `freeDeliveryThreshold`، فقط عدد صحیح تومان (Zod + validator مدل). **هیچ مقدار پیش‌فرضی seed نمی‌شود** (مقادیر ۲۵٬۰۰۰/۵۰۰٬۰۰۰ Legacy تصمیم کسب‌وکار تأییدشده نیست)؛ تا اولین ذخیره `isConfigured:false` و UI حالت «هنوز تعیین نشده» نشان می‌دهد. ⚠️ سبد/checkout آینده باید حالت تنظیم‌نشده را مدیریت کنند.
- **AuditLog:** تغییر شماره (قبل/بعد)، تغییر رمز (بدون مقدار)، ذخیره‌ی تنظیمات فروشگاه/ارسال (قبل/بعد).
- **تغییرات پشتیبان:** `OtpPurpose` جدید `phone_change` (packages/shared)، `requireAdmin` در `guard.ts`، `lib: DOM` در `app/tsconfig.json`.
- **تست:** `npm run verify` پاس؛ ۱۱۲ تست (۹ تست Zod، ۱۰ تست کامپوننت کارت‌ها، helper پول/رقم فارسی). smoke روی سرور production با توکن امضاشده: نقش customer → ۴۰۳، مبلغ اعشاری/منفی/رشته‌ای/نام خالی/رمز کوتاه → ۴۰۰ قبل از هر اتصال DB.
- **اجرا نشده (محدودیت sandbox):** تست یکپارچه‌ی `profileSettings.integration.test.ts` (نوشته شده، نیاز به MongoDB)، مسیر موفق واقعی API با DB، بررسی بصری ۳۷۵/۷۶۸/۱۲۸۰، axe، E2E، ارسال واقعی sms.ir.
- **نکته‌ی عملیاتی:** `getEnv()` در production با `SMS_PROVIDER=console` می‌ترکد و چون `requireAuth` همه‌ی خطاها را «نشست نامعتبر» گزارش می‌کند، اشتباه در env ورسل به‌شکل ۴۰۱ همه‌جا دیده می‌شود.

## کارهای تأییدنشده / محدودیت شناخته‌شده

- **Playwright e2e اجرا نشد.** دانلود باینری مرورگر Chromium از `cdn.playwright.dev` در sandbox فعلی مسدود است (خارج از allowlist شبکه). فایل `e2e/smoke.spec.ts` نوشته شده ولی تا اجرای واقعی در محیط dev/CI با دسترسی شبکه کامل، «تست‌شده» تلقی نشود.
- **تست‌های یکپارچه‌ی مدل (`npm run test:integration`) اجرا نشدند.** همان محدودیت شبکه — دانلود باینری MongoDB از `fastdl.mongodb.org` مسدود است. فایل `persistence.integration.test.ts` (Phase 2) و `otpService.integration.test.ts`/`authService.integration.test.ts` (Phase 3) نوشته شده‌اند؛ باید در dev/CI واقعی اجرا و تأیید شوند.
- **SMS:** provider واقعی sms.ir پیاده شد (Phase 4) ولی ارسال واقعی با کلید واقعی هنوز تست نشده؛ `ConsoleSmsProvider` فقط dev.
- **بررسی بصری واقعی (screenshot) طراحی UI انجام نشد.** این sandbox ابزار رندر/مرورگر تصویری ندارد. صفحات جدید (storefront/admin/courier shell) فقط با build/typecheck تأیید شدند، نه با چشم — باید طبق پروتکل صفحه (§۲۴ Master Prompt) در ۳۷۵px/۷۶۸px/۱۲۸۰px در محیط واقعی بررسی شوند.
- axe accessibility testing هنوز راه‌اندازی نشده.
- MongoDB واقعی برای dev/test در sandbox فعلی نصب نیست؛ اتصال فقط با کانفیگ صحیح تست شد، نه با DB واقعی در حال اجرا.

## قوانین محیطی

متغیرهای محیطی در `app/.env.example` مستند شده‌اند. الزامی در این مرحله: `MONGODB_URI`، `JWT_ACCESS_SECRET`، `JWT_REFRESH_SECRET`. بقیه (OTP/Password/SMS_PROVIDER) پیش‌فرض دارند. رمزها هرگز کامیت نشوند.

## نکته‌ی معماری برای جلسات آینده

هرگونه بک‌اند/سرویس جدید باید به‌صورت Next.js Route Handler زیر `app/src/app/api/v1/...` نوشته شود، با لایه‌بندی Route → Service → Model، و همیشه از پوشش پاسخ استاندارد (`app/src/lib/server/apiResponse.ts`) استفاده کند. هرگز الگوی Express را دوباره معرفی نکنید — این تصمیم توسط کاربر گرفته و ثبت شده است.

## مرحله‌ی بعد

Phase 3 (پایه‌ی احراز هویت + routing/UI system/API client) کامل شد. مرحله‌ی بعد طبق نقشه‌ی
راه: **Phase 4 — Admin، شروع با «Authentication»** یعنی صفحه‌ی ورود واقعی (`/admin` +
`page.tsx` ورود با رمز عبور، فرم با `react-hook-form`+Zod، استفاده از `apiClient` برای
`POST /api/v1/auth/login/password`)، طبق پروتکل کامل پیاده‌سازی صفحه (§۲۴ Master Prompt:
Spec → Backend (آماده) → Frontend → Verification → Docs → Git → Stop).

- در محیط dev/CI با دسترسی شبکه‌ی کامل: `npm run test:integration` و `npm run test:e2e` را اجرا و نتیجه را در این فایل ثبت کنید.
- بررسی بصری واقعی (۳۷۵/۷۶۸/۱۲۸۰px) صفحات ساخته‌شده در این فاز، در محیط dev واقعی.
- قبل از استقرار: `SMS_PROVIDER=smsir` + کلید/Template در Vercel و ساخت Template با متغیر `#Code#` در پنل sms.ir.
