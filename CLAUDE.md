# CLAUDE.md — Persboy (fruitland)

این فایل حافظه‌ی عملیاتی پروژه است. فقط شامل چیزهایی است که واقعاً پیاده‌سازی و تأیید شده‌اند.

## وضعیت فعلی

- **فاز:** Phase 4 — Admin — صفحه‌ی ۱ (Authentication) تأیید شد؛ صفحه‌ی ۲ (Settings) پیاده‌سازی شد، منتظر تأیید کاربر. فاز ۴.۵ (نقشه) در جریان: مرحله‌ی ۸ (MapService — retry/fallback) کامل. بعدی پس از تأیید: مرحله‌ی ۹ نقشه (API routes)
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




## قانون سراسری UI: اعداد و مبالغ (دستور کاربر)

هر عددی که کاربر تایپ می‌کند (مبلغ، تعداد، آستانه، …) باید **زنده با جداکننده‌ی هزارگان فارسی «٬» و ارقام فارسی** نمایش داده شود، نه رشته‌ی خام ارقام. راه استاندارد: `formatNumberInput` (ورودی) + `parseTomanInput` (تبدیل به عدد صحیح) + `formatToman` (نمایش) در `app/src/lib/client/format.ts`. هر فرم جدید با ورودی عددی باید از همین‌ها استفاده کند. استثنا: مقادیر شناسه‌ای که عدد «مقدار» نیستند (شماره موبایل، کد OTP، کد پستی، کد ۵ رقمی مشتری).

## قانون سراسری UI: لایه‌بندی (z-index) نقشه‌ها (دستور کاربر)

نقشه هرگز نباید روی تاپ‌بار، سایدبار، باتم‌بار، دیالوگ و منوهای شناور بیفتد. کتابخانه‌های نقشه (Leaflet) داخل خود z-index تا ۱۰۰۰ استفاده می‌کنند؛ پس هر نقشه باید داخل یک wrapper با `relative isolate z-0` قرار بگیرد تا stacking context مستقل بسازد و z-index داخلی‌اش بیرون نشت نکند. مقیاس لایه‌های فعلی: محتوا/نقشه `z-0` < تاپ‌بار `z-30` < بک‌دراپ `z-40` / منوی کاربر `z-40` < سایدبار `z-50`. هر لایه‌ی شناور جدید (باتم‌بار، شیت، دیالوگ) باید در همین مقیاس ثبت شود.

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

## قانون شماره‌گذاری فازهای میانی (دستور کاربر)

هر کار جدیدی که کاربر بین فازها بخواهد و در MASTER-PROMPT نباشد، یک **فاز نیم** است و به‌شکل `N.5` ثبت می‌شود (مثلاً بین فاز ۴ و ۵: فاز ۴.۵). ترتیب اجرا همچنان بر اساس تأیید کاربر است.

## Phase 4.5 — سیستم نقشه، آدرس‌یابی و مسیریابی (Multi-Provider)

مرجع: پرامپت معماری کاربر (Neshan + Map.ir + Google). معماری: `Frontend → /api/v1/maps/* → MapService → MapProvider → Neshan/Map.ir/Google`؛ هیچ کد کسب‌وکاری نباید مستقیم به Provider وابسته باشد. کاربر تأیید کرد: (۱) ساختار `app/src/lib/server/maps/` + مسیرهای `/api/v1/maps/*`، (۲) Address همان embedded در User می‌ماند با فیلدهای نرمال‌شده‌ی جدید (فاز ۱۰ نقشه)، (۳) Cache به‌شکل رابط `MapCache` با پیاده‌سازی in-memory (روی Vercel serverless محدود است)، (۴) هر فاز با گزارش و توقف.

**مراحل داخلی (شماره‌ی نقشه‌ی خودش؛ بدون تأیید کاربر وارد مرحله‌ی بعد نمی‌شویم):**
1. تحلیل مخزن — ✅ انجام و تأیید شد.
2. دامنه‌ی نقشه — ✅ تأیید شد (`packages/shared/src/maps/types.ts`: `Coordinates`، `NormalizedAddress`، `GeocodeResult`، `PlaceResult`، `RouteResult`، `RouteGeometry`، schema مختصات) فیلد ناموجود همیشه `null` صریح است. هندسه‌ی مسیر GeoJSON با ترتیب `[lng, lat]`. Route Matrix عمداً هنوز تعریف نشده (YAGNI، فاز ۳).
3. Provider interfaces — ✅ تأیید شد. `app/src/lib/server/maps/`: `provider.ts` (`MapProvider` = `GeocodingProvider` + `PlacesProvider` + `RoutingProvider` + `name` + `capabilities`؛ `getRouteMatrix` اختیاری)، `errors.ts` (`MapProviderError{provider,operation,code,message,retryable}` با کدهای `INVALID_REQUEST/AUTH_FAILED/RATE_LIMIT/TIMEOUT/NETWORK/PROVIDER_UNAVAILABLE/NO_RESULT/INVALID_RESPONSE/UNSUPPORTED_OPERATION`؛ `errorFromHttpStatus` یکسان برای هر سه provider؛ `toSafeJSON()` بدون هیچ header/URL/کلید)، `testing/FakeMapProvider.ts` (فقط برای تست). قواعد: Retry فقط برای `TIMEOUT/NETWORK/PROVIDER_UNAVAILABLE/RATE_LIMIT`؛ Fallback فقط برای `TIMEOUT/NETWORK/PROVIDER_UNAVAILABLE` (نه AUTH_FAILED/INVALID_REQUEST/RATE_LIMIT). `RouteMatrixResult` به دامنه‌ی مشترک اضافه شد. **Capability Matrix واقعی هر provider** در مرحله‌ی خودش از مستندات رسمی ثبت می‌شود، نه حدسی.
4. NeshanProvider — ✅ پیاده‌سازی شد؛ منتظر تأیید. `maps/providers/neshan.provider.ts` + `maps/http.ts` (GET+JSON با timeout اجباری و خطای نرمال‌شده؛ URL/هدر/کلید هرگز در خطا نمی‌آید) + `maps/polyline.ts` (decode پلی‌لاین precision 5 → GeoJSON `[lng,lat]`). از مستندات رسمی (بررسی‌شده ۲۰۲۶-۰۹-۲۴): `GET /v5/reverse?lat&lng`، `GET /v1/search?term&lat&lng` (نشان **lat/lng مرجع را الزامی** می‌کند؛ بدون `options.near` خطای `INVALID_REQUEST`)، `GET /v4/direction?type=car&origin&destination` (با ترافیک)، احراز هویت با هدر `Api-Key`، خطاها به‌صورت HTTP status ‏۴۷۰/۴۸۰/۴۸۱/۴۸۲/۴۸۳.
   **Capability Matrix (Neshan):** reverseGeocode ✅ · searchPlaces ✅ · getRoute ✅ · **geocode ❌** (Neshan «Geocoding API» دارد ولی endpoint/پاسخش از مستندات قابل تأیید نبود؛ حدس نزدم و با search هم جعلش نکردم → `UNSUPPORTED_OPERATION`) · routeMatrix ❌ (اختیاری، MVP خاموش).
   **نگاشت reverse:** `state`→province (پیشوند «استان » حذف)، `city`→city، `neighbourhood`→neighborhood، `route_name`→street، `municipality_zone`→district («منطقه N»)؛ `alley/plaque/unit/postalCode` = `null` (Neshan نمی‌دهد). نگاشت خطا: ۴۷۰→INVALID_REQUEST، ۴۸۰/۴۸۳→AUTH_FAILED، ۴۸۱ (سهمیه تمام)→RATE_LIMIT **غیرقابل‌retry**، ۴۸۲ (نرخ/دقیقه)→RATE_LIMIT قابل‌retry، ۵xx→PROVIDER_UNAVAILABLE.
   ⚠️ **کلید Neshan نوع دارد:** مستندات کد ۴۸۳ (`ApiKeyTypeError`) را «کلید با سرویس هم‌خوان نیست» تعریف می‌کند و در عمل کلید «Web Map» و «Web Service» جداست. سرور فقط `NESHAN_API_KEY` را می‌خواند و باید از نوع **سرویس** باشد. اگر کلید فعلی فقط برای نقشه است، تست زنده ۴۸۳ می‌دهد (پیام خطا همین را می‌گوید). کلید نقشه‌ی مرورگر در مرحله‌ی ۱۲ تعیین می‌شود.
   **باز:** نوع وسیله‌ی مسیر (`car` پیش‌فرض؛ موتور پیک؟) تصمیم کسب‌وکار نیست. تست زنده با کلید واقعی در sandbox ممکن نیست (مرحله‌ی ۱۶: `npm run test:maps:live`).
5. **بررسی معماری Rendering vs Service (میان‌فاز، به دستور کاربر — قبل از ادامه‌ی مرحله‌ی ۵ متوقف شد)** — ✅ انجام شد؛ منتظر تأیید. نتیجه در «تصمیم معماری Rendering/Service» زیر.
6. MapIrProvider — ✅ پیاده‌سازی شد؛ منتظر تأیید. `maps/providers/mapir.provider.ts`. از منابع رسمی Map.ir (بررسی‌شده ۲۰۲۶-۰۹-۲۵: `help.map.ir/reverse_api` — جدول کامل پارامتر ورودی/خروجی؛ `corp.map.ir/map-services/unauthorized` — کد ۴۰۱ برای کلید نامعتبر/غایب؛ دامنه‌ی پایه‌ی `https://map.ir` از پکیج رسمی Laravel مپ تأیید شد): `GET https://map.ir/reverse/?lat&lon` با هدر `x-api-key`.
   **Capability Matrix (Map.ir):** reverseGeocode ✅ · **geocode ❌ · searchPlaces ❌ · getRoute ❌ · routeMatrix ❌** — Map.ir رسماً صفحات جداگانه برای Search v1/v2، Route، Distance Matrix و Places دارد، ولی fetch مستقیم این صفحات در همین session به دلیل robots.txt مسدود شد و نتوانستم مثال کامل و رسمی پاسخ (field-by-field) هیچ‌کدام را تأیید کنم؛ طبق قانون «هرگز حدس نزن»، به‌جای پیاده‌سازی از روی قطعات نیمه‌رسمی (npm wrapperهای شخص ثالث)، همه `UNSUPPORTED_OPERATION` ماندند. اگر متن کامل هرکدام از این صفحات را (مثل کاری که برای Geocoding نشان کردید) بفرستید، در همین فاز (نه ۵.۵) اضافه می‌شوند، چون قابلیت از پیش برنامه‌ریزی‌شده‌ی همین Provider است، نه نیاز جدید.
   **نگاشت reverse:** `province`→province، `city`→city، `region` («منطقه شهرداری»)→district، `neighborhood`→neighborhood، `primary`→street، `plaque` (عددی)→plaque (رشته)، `postal_code`→postalCode، `address`→formattedAddress؛ Map.ir فیلد جدایی برای کوچه یا واحد ندارد → `alley`/`unit` = `null`.
   **خطاها:** Map.ir کد خطای اختصاصی مستند نکرده (برخلاف Neshan)، پس فقط نگاشت عمومی HTTP اعمال شد (۴۰۱/۴۰۳→AUTH_FAILED، ۴۲۹→RATE_LIMIT، 5xx→PROVIDER_UNAVAILABLE)؛ چیزی حدس زده نشد.
   **کلید:** طبق مستندات، همان کلید REST (`x-api-key`) در Web SDK هم استفاده می‌شود → **یک credential مشترک** (برخلاف Neshan). پس فقط `MAPIR_API_KEY` لازم است؛ ردیف Map.ir در جدول credential فاز قبل به «تأیید شد: یک credential» به‌روزرسانی شد.
7. GoogleMapsProvider — ✅ پیاده‌سازی شد؛ منتظر تأیید. `maps/providers/google.provider.ts`. تنها Providerی که **هر پنج قابلیت** را دارد، چون مستندات رسمی Google (بررسی‌شده ۲۰۲۶-۰۹-۲۵) برای همه پاسخ کامل و تأییدشده داد:
   - **reverseGeocode/geocode:** `GET https://maps.googleapis.com/maps/api/geocode/json?latlng=|address=&key=`. ⚠️ **تفاوت مهم با Neshan/Map.ir:** کلید اینجا **query param** است نه هدر، و HTTP همیشه ۲۰۰ برمی‌گردد؛ موفقیت/خطا فقط از فیلد JSON `status` خوانده می‌شود (`OK/ZERO_RESULTS/OVER_QUERY_LIMIT/OVER_DAILY_LIMIT/REQUEST_DENIED/INVALID_REQUEST/UNKNOWN_ERROR`). این یک ناسازگاری معماری نیست (طبق دستور کاربر بند ۱۰ فاز ۶، چون هیچ تغییری در contract مشترک لازم نشد؛ فقط adapter داخلی خودش را با شکل مستندشده‌ی همین API تطبیق داد) — فقط باید حواس‌مان باشد این کلید فقط داخل URL درخواست می‌رود، نه در خطا/لاگ (تست شده).
   - **searchPlaces:** `POST https://places.googleapis.com/v1/places:searchText` (Places API **New**)، هدر `X-Goog-Api-Key` + `X-Goog-FieldMask` اجباری؛ `locationBias.circle` برای `options.near`.
   - **getRoute:** `POST https://routes.googleapis.com/directions/v2:computeRoutes` (Routes API). `duration` رشته‌ای «۲۴۲۰s» است، پارس شد. Geometry از همان دیکدر پلی‌لاین Neshan (الگوریتم مشترک گوگل) استفاده می‌کند.
   - **routeMatrix:** `POST https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix`. ⚠️ پاسخ یک **آرایه‌ی برهنه** است (نه شیء)، و مستندات صریح می‌گویند ترتیب عناصر تضمین‌شده نیست → با `originIndex/destinationIndex` در grid `rows[][]` جای می‌گیرد، نه ترتیب دریافت. سلولی که `condition!=="ROUTE_EXISTS"` یا `status` غیرخالی داشته باشد `null` می‌ماند (هرگز ۰).
   **Capability Matrix (Google):** هر پنج قابلیت ✅. برای POST-ها errorFromHttpStatus عمومی مشترک با بقیه استفاده شد (پاکت خطای استاندارد Google `{error:{code,status,message}}`)؛ فقط Geocoding قدیمی نگاشت اختصاصی خودش را دارد (بالا). `OVER_DAILY_LIMIT`→`AUTH_FAILED` غیرقابل‌retry (مستندات: کلید/billing، نه نرخ لحظه‌ای)، `OVER_QUERY_LIMIT`→`RATE_LIMIT` قابل‌retry، `UNKNOWN_ERROR`→`PROVIDER_UNAVAILABLE` قابل‌retry (مستندات صراحتاً می‌گویند تلاش دوباره ممکن است جواب بدهد).
   **نوع وسیله:** هر سه مقدار مشترک پروژه (`car→DRIVE`, `motorcycle→TWO_WHEELER`, `bicycle→BICYCLE`) رسماً مستند و پشتیبانی‌شده‌اند (WALK/BICYCLE/TWO_WHEELER رسماً «beta» اعلام شده‌اند، ولی endpoint و پاسخشان کاملاً مستند است) — پس هیچ‌کدام `UNSUPPORTED_OPERATION` نشدند.
   **نگاشت آدرس:** از `address_components[].types` استاندارد گوگل: `administrative_area_level_1`→province، `locality` (یا در نبودش `administrative_area_level_2`)→city، `sublocality`→district، `neighborhood`→neighborhood، `route`→street، `street_number`→plaque، `postal_code`→postalCode. گوگل نوع جداگانه‌ای برای کوچه یا واحد ندارد → `alley`/`unit`=`null`.
   **credential:** فقط **یک متغیر سرور**: `GOOGLE_MAPS_API_KEY`، با سه API فعال (Geocoding، Places New، Routes) روی همان کلید. طبق دستور صریح کاربر، رندر مرورگر در این فاز پیاده نشد؛ توصیه‌ی رسمی Google (کلید سرور با IP restriction جدا از کلید مرورگر با HTTP referrer restriction) فقط مستند شد، نه اجرا.
8. Provider Factory / Registry — ✅ پیاده‌سازی شد؛ منتظر تأیید. `maps/registry.ts` (الگوی دقیقاً مشابه `services/sms/index.ts` موجود پروژه): `getMapProvider(name)` با شناسه‌ی پایدار `neshan|mapir|google` provider واقعی می‌سازد و کش می‌کند (stateless، یک نمونه به‌ازای هر نام، بدون بازسازی غیرضروری)؛ `getDefaultMapProvider()` از `MAP_PROVIDER` می‌خواند؛ `resetMapProviderRegistryForTests()` فقط برای تست. هیچ‌جای دیگر پروژه مجاز نیست مستقیم `new NeshanProvider(...)` و مشابه بسازد.
   **اعتبارسنجی `MAP_PROVIDER` در `env.ts` (لایه‌ی پیکربندی واحد):** `z.enum(["neshan","mapir","google"]).default("neshan")` — مقدار نامعتبر باعث شکست واضح در همان لحظه‌ی بالا آمدن سرویس می‌شود (Zod error حاوی «MAP_PROVIDER»)، **هرگز fallback خاموش به provider دیگر نیست**. `NESHAN_API_KEY`/`MAPIR_API_KEY`/`GOOGLE_MAPS_API_KEY` هم اکنون رسماً در schema هستند (قبلاً فقط در `.env.example` رزرو بودند) ولی هرکدام تنها **وقتی همان provider واقعاً resolve شود** در `registry.ts` بررسی می‌شوند، نه در سطح env سراسری — یعنی نبودن `GOOGLE_MAPS_API_KEY` وقتی `MAP_PROVIDER=neshan` است، جلوی بالا آمدن سرویس را نمی‌گیرد (این طراحی صریحاً برای Comparison Mode آینده هم لازم است: هر provider خطای خودش را مستقل می‌دهد). `MAP_REQUEST_TIMEOUT_MS` (پیش‌فرض ۱۰۰۰۰) هم به schema اضافه شد چون ساخت هر provider به آن نیاز دارد؛ بقیه‌ی متغیرهای MapService (`MAP_MAX_RETRIES`, `MAP_CACHE_*`, `MAP_ENABLE_COMPARISON`, `MAP_FALLBACK_PROVIDER`) طبق مرز فاز ۷ **عمداً هنوز اعتبارسنجی نشدند** — فاز ۹ (MapService).
   **MapService:** هنوز ساخته نشده (فاز ۹ خودِ نقشه). هیچ چیزی برای اتصال به registry وجود نداشت؛ registry آماده است تا MapService در فاز خودش مستقیماً `getDefaultMapProvider()`/`getMapProvider()` را صدا بزند، بدون آنکه پیاده‌سازی providerها را بشناسد.
   **Rendering:** طبق دستور صریح کاربر، در این فاز هیچ registry یا کد رندری اضافه نشد.
9. MapService — ✅ پیاده‌سازی شد؛ منتظر تأیید. `maps/service.ts`: کلاس `MapService` (فقط سیاست retry/fallback؛ هیچ provider مشخصی را نمی‌شناسد یا import نمی‌کند) + `createMapService(overrides?)` (تنها نقطه‌ی اتصال به Registry/env — `getDefaultMapProvider()` یا `getMapProvider(name)` صریح).
   **معماری نهایی لایه‌ها:** `API/Controller → MapService → Provider Registry → MapProvider → Neshan/Map.ir/Google`.
   **Retry:** فقط وقتی `MapProviderError.retryable===true` (یعنی `TIMEOUT/NETWORK/PROVIDER_UNAVAILABLE` همیشه، و `RATE_LIMIT` فقط وقتی خودِ provider آن را قابل‌retry اعلام کرده باشد — دقیقاً همان چیزی که در فاز ۳ در `errors.ts` تعریف شد، اینجا فقط استفاده شد، نه تعریف مجدد). هر تلاش «۱ اجرای اول + حداکثر `MAP_MAX_RETRIES` تلاش دیگر» است، کراندار و بدون حلقه‌ی بی‌نهایت (`MAP_MAX_RETRIES=0` یعنی دقیقاً یک تلاش). خطای غیرقابل‌retry بلافاصله متوقف می‌شود.
   **Fallback:** فقط وقتی `MapProviderError.fallbackEligible===true` (`TIMEOUT/NETWORK/PROVIDER_UNAVAILABLE`، **هرگز** `AUTH_FAILED`، `INVALID_REQUEST`، `UNSUPPORTED_OPERATION` یا `RATE_LIMIT` غیرقابل‌retry — طبق تصمیم قبلاً ثبت‌شده در فاز ۳). قبل از فراخوانی fallback، `Capability Matrix` واقعی‌اش چک می‌شود (هرگز قابلیتی که ندارد جعل نمی‌شود)؛ اگر fallback آن قابلیت را ندارد یا اصلاً پیکربندی نشده یا با primary یکی باشد، **خطای اصلی primary** بدون تغییر برگردانده می‌شود (هیچ خطای جعلی جدید ساخته نشد). اگر fallback هم شکست بخورد، خطای نرمال‌شده‌ی خودِ fallback برگردانده می‌شود (نه خطای primary — چون این آخرین رخداد واقعی است). fallback هم همان سیاست retry را می‌گیرد (یک بار، با همان `MAP_MAX_RETRIES`).
   **پیکربندی:** `MAP_FALLBACK_PROVIDER` حالا در `env.ts` است (همان enum سه‌گانه یا رشته‌ی خالی؛ مقدار نامعتبر = شکست واضح در بالا آمدن سرویس، هرگز انتخاب خاموش provider دیگر). `MAP_MAX_RETRIES` هم به schema اضافه شد (`min(0)`, پیش‌فرض ۲). **قانون مهم:** اگر fallback پیکربندی شده باشد ولی کلیدش نباشد، `createMapService()` **عمداً throw می‌کند** (خطای پیکربندی هرگز پشت رفتار fallback پنهان نمی‌شود) — این تفاوت آگاهانه با فاز ۷ است که در آن نبودِ کلید یک provider استفاده‌نشده مانع بالا آمدن نمی‌شد؛ اینجا چون کاربر صریحاً همان provider را به‌عنوان fallback خواسته، نبودنش پیکربندی خراب است.
   **بدون تغییر (طبق مرز فاز):** cache، rate limiting، API routes، رندر مرورگر، Comparison Mode — هیچ‌کدام لمس نشدند.
   **تست:** ۳۶ تست جدید — تمام سناریوهای فهرست‌شده‌ی کاربر (۳ کد قابل‌retry، RATE_LIMIT قابل/غیرقابل، ۵ کد بدون retry، سقف retry، `MAP_MAX_RETRIES=0`، خطای غیر-MapProviderError بدون retry، ۳ کد fallback-eligible، ۳ کد بدون fallback، fallback هم‌نام primary، fallback بدون قابلیت، شکست fallback، retry روی fallback، و ۸ تست `createMapService` با env واقعی).
10. تا ۱۷. API، Address، MapView/LocationPicker، AddressPicker، Routing، Comparison، تست‌ها، مستندات — ⏳ شروع نشده.

### تصمیم معماری: Rendering Provider جدا از Service (Map) Provider

کاربر تأیید کرد که این دو لایه **مستقل** هستند و هیچ‌کدام نباید فرض «Neshan همیشه برای رندر» را hard-code کند:

- **`MapProvider` (Service — همان چیزی که تا الان ساختیم):** reverseGeocode/geocode/searchPlaces/getRoute/routeMatrix. کاملاً سرور-به-سرور، Frontend هرگز مستقیم آن را صدا نمی‌زند.
- **`MapRenderingProvider` (جدید، هنوز پیاده‌سازی نشده):** فقط نمایش کاشی/نقشه، Marker، Zoom، Pan در مرورگر. Frontend مستقیماً با SDK مرورگرِ همان provider حرف می‌زند (نه از طریق `/api/v1/maps/*`)، ولی انتخاب اینکه کدام provider رندر شود از همان config مرکزی (فعلاً `MAP_PROVIDER`، قابل جدا شدن به `MAP_RENDER_PROVIDER` در فاز رندر اگر لازم شد) می‌آید. Business logic (Checkout/Address/Order) به هیچ‌کدام از این دو لایه وابسته نیست.

**Credential Matrix (بررسی‌شده از مستندات/منابع رسمی هر پلتفرم، ۲۰۲۶-۰۹-۲۴):**

| Provider | Service API (سرور) | Map Rendering (مرورگر) | نتیجه |
|---|---|---|---|
| **Neshan** | کلید نوع «سرویس» (`Api-Key` هدر) | کلید **جدا**، نوع «نقشه وب» — در پنل هنگام ساخت کلید صراحتاً باید نوع «نقشه وب» انتخاب شود؛ خطای مستندشده‌ی ۴۸۳ (`ApiKeyTypeError`) دقیقاً همین ناهمخوانی را پوشش می‌دهد | **دو کلید، دو نوع credential** |
| **Map.ir** | `x-api-key` هدر برای REST | همان توکن پروژه در Web/React SDK (`x-api-key` + هدر `Mapir-SDK`) | **تأیید شد در مرحله‌ی MapIrProvider: یک credential مشترک** |
| **Google** | کلید استاندارد Google Maps Platform (Geocoding/Directions/Places API) | همان نوع کلید (Maps JavaScript API) — Google رسماً کلید سرور و مرورگر را «یک نوع» می‌داند ولی توصیه‌ی صریح دارد که برای هرکدام یک کلید جدا با محدودیت متفاوت بسازید (سرور: IP restriction؛ مرورگر: HTTP referrer restriction) | **یک نوع credential، ولی به دو کلید جدا با scope متفاوت توصیه می‌شود** |

**نتیجه:** سه Provider سه الگوی متفاوت دارند، پس **abstraction مشترک برای رندر هنوز زودهنگام است** تا وقتی مرحله‌ی رندر واقعاً برسد؛ فقط این تصمیم ثبت می‌شود که `MapRenderingProvider` به‌عنوان یک interface مستقل از `MapProvider` طراحی خواهد شد (نه `NeshanRenderer extends NeshanProvider` یا مشابه آن)، و انتخاب و اعتبارسنجی credential رندر هرکدام در فاز خودش انجام می‌شود — نه الان.

**ENV — طبق دستور کاربر، فقط چیزی که نقش و نوعش روشن است در `.env.example` می‌ماند:** `NESHAN_API_KEY` همچنان فقط برای Web Service سمت سرور است. هیچ متغیر رندر (مثل یک `NESHAN_MAP_KEY` حدسی) اضافه نشد؛ آن‌وقتی که فاز رندر برسد، بر اساس نتیجه‌ی نهایی این‌جا تعیین می‌شود.

### تصمیم معماری: نوع وسیله (car/motorcycle) قابل‌تنظیم است، نه hard-code

`RouteOptions.vehicleType?: VehicleType` (از enum مشترک `car|motorcycle|bicycle`) به رابط `RoutingProvider` اضافه شد. Business logic هیچ مقداری را ثابت نمی‌فرستد. `NeshanProvider.getRoute` این را به `type=car` یا `type=motorcycle` نگاشت می‌کند (Neshan بایسیکل ندارد → `bicycle` باعث `UNSUPPORTED_OPERATION` می‌شود، نه fallback خاموش). اگر caller چیزی ندهد، پیش‌فرض adapter (نه Business logic) اعمال می‌شود — برای Neshan `car`.


- **پس از فاز ۱۲–۱۳ نقشه:** افزودن لوکیشن به کارت «اطلاعات فروشگاه» در Settings (نیازمند افزودن `latitude/longitude` اختیاری به `StoreSettings`؛ تأیید کاربر لازم است).

**کلیدها:** کاربر گزارش داد در پنل Neshan فقط یک کلید می‌بیند → سرور فقط `NESHAN_API_KEY` را می‌خواند. ⚠️ مستندات Neshan برای کلید «نوع» تعریف می‌کند (خطای ۴۸۳)؛ اگر تست زنده ۴۸۳ داد، باید کلید نوع سرویس ساخته شود (جزئیات در مرحله‌ی ۴ بالا). کلید مرورگر چون ناچار در مرورگر دیده می‌شود باید در پنل به دامنه محدود شود. نام‌های محیطی رزروشده در `app/.env.example` (ولی تا مرحله‌ی ۷ در `env.ts` اعتبارسنجی نمی‌شوند): `MAP_PROVIDER`، `NESHAN_API_KEY`، `MAPIR_API_KEY`، `GOOGLE_MAPS_API_KEY`، `MAP_FALLBACK_PROVIDER`، `MAP_ENABLE_COMPARISON`، `MAP_ENABLE_ROUTE_MATRIX`، `MAP_REQUEST_TIMEOUT_MS`، `MAP_MAX_RETRIES`، `MAP_CACHE_ENABLED`، `MAP_CACHE_TTL_SECONDS`.
**تصمیم باز (مرحله‌ی ۱۲):** فرض پیش‌فرض این است که کاشی‌های نقشه همیشه از Neshan رندر شوند و Provider فعال فقط geocode/search/route را عوض کند؛ اگر خواستید نقشه‌ی Google/Map.ir هم رندر شود، کلید مرورگر جدا لازم می‌شود.

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
