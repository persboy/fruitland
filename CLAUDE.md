# CLAUDE.md — Persboy (fruitland)

این فایل حافظه‌ی عملیاتی پروژه است. فقط شامل چیزهایی است که واقعاً پیاده‌سازی و تأیید شده‌اند.

## وضعیت فعلی

- **فاز:** Phase 4 — Admin — صفحه‌ی ۱ (Authentication) تأیید شد؛ صفحه‌ی ۲ (Settings) پیاده‌سازی شد، منتظر تأیید کاربر. فاز ۴.۵ (نقشه) در جریان: مرحله‌ی ۹ تأیید شد (endpointها `requireAuth`، بدون محدودیت نقش). مرحله‌ی ۱۱ تأیید شد. مرحله‌ی ۱۲ (MapView/LocationPicker frontend) کامل. مرحله‌ی ۱۳ (Map Rendering Provider: Neshan/Google/Leaflet) پیاده شد، منتظر تأیید. مرحله‌ی ۱۴ (Courier & Delivery Domain: DeliveryRun) پیاده شد، منتظر تأیید. بعدی پس از تأیید: API مربوط به DeliveryRun / اتصال به یک صفحه‌ی واقعی
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
10. API Routes — ✅ پیاده‌سازی شد؛ منتظر تأیید. زیر `app/src/app/api/v1/maps/`، دقیقاً طبق کانونشن Next.js App Router موجود پروژه (نه Express):

   | Route | Method | ورودی | خروجی موفق |
   |---|---|---|---|
   | `/api/v1/maps/reverse-geocode` | GET | query: `lat`, `lng`, `provider?` | `ReverseGeocodeResult` |
   | `/api/v1/maps/geocode` | GET | query: `address`, `provider?` | `GeocodeResult[]` |
   | `/api/v1/maps/search` | GET | query: `query`, `lat?`, `lng?` (هر دو یا هیچ‌کدام)، `limit?` (۱-۲۰)، `provider?` | `PlaceResult[]` |
   | `/api/v1/maps/route` | POST | body: `{origin, destination, provider?, vehicleType?, includeGeometry?}` | `RouteResult` |
   | `/api/v1/maps/route-matrix` | POST | body: `{origins[] (≤۲۵), destinations[] (≤۲۵), provider?}` | `RouteMatrixResult` |

   **معماری:** `Route Handler → createMapService({provider}) → Registry → MapProvider → Neshan/Map.ir/Google`. هیچ route handler مستقیم provider نمی‌سازد، retry/fallback ندارد و پاسخ خام provider را برنمی‌گرداند — فقط نوع‌های مشترک domain (نه ساختار Neshan/Map.ir/Google) در پاسخ هستند، دقیقاً طبق envelope موجود پروژه (`apiSuccess`/`apiErrorFromException`).
   **اعتبارسنجی:** `maps/apiSchemas.ts` (Zod؛ از `coordinatesSchema`/`routeRequestSchema`/`VEHICLE_TYPES`/`MAP_PROVIDER_NAMES` مشترک استفاده می‌کند، دوباره تعریف نمی‌کند). GET با `validation/parseQuery.ts` (کمکی جدید و عمومی، هم‌الگو با `parseJsonBody` موجود؛ query-stringها با `z.coerce`/transform به عدد تبدیل می‌شوند). خطاها همان `AppError.badRequest("...", "VALIDATION_ERROR")` موجودند.
   **نگاشت خطا:** `maps/apiError.ts` → `translateMapError()`، یک جدول ثابت `MapErrorCode → {status, code فارسی}`: `INVALID_REQUEST/UNSUPPORTED_OPERATION`→۴۰۰، `NO_RESULT`→۴۰۴، `RATE_LIMIT`→۴۲۹، `AUTH_FAILED/NETWORK/INVALID_RESPONSE/PROVIDER_UNAVAILABLE`→۵۰۲ (مشکل ما/upstream است، نه کاربر — عمداً نه ۴۰۱/۴۰۳)، `TIMEOUT`→۵۰۴. پیام فارسی پاسخ **همیشه از یک جدول ثابت** است، هرگز `err.message` واقعی provider (که می‌تواند جزئیات داخلی داشته باشد) به کلاینت نمی‌رسد — تست شده. خطای غیر-`MapProviderError` دست‌نخورده به `apiErrorFromException` می‌رود (۵۰۰ عمومی، بدون افشا؛ رفتار از قبل موجود پروژه).
   ⚠️ **تصمیم امنیتی که هنوز باز است (طبق دستور شما گزارش می‌شود، حدس زده نشد):** پروژه هنوز مشخص نکرده این endpointها باید عمومی باشند یا محدود به نقش خاص. چون این APIها منابع پولی (Google/Neshan/Map.ir) را صدا می‌زنند و «هیچ درخواست غیرضروری نباید برود» (اصل صریح پرامپت نقشه)، به‌عنوان پیش‌فرض محافظه‌کارانه `requireAuth` (هر کاربر واردشده، بدون محدودیت نقش) گذاشتم — نه public، نه فقط-admin. این باید توسط شما تأیید یا اصلاح شود (مثلاً محدود به customer/admin/courier مشخص).
   **Route Matrix:** طبق دستور صریح شما، expose شد چون MapService/Provider از قبل پشتیبانی می‌کنند، ولی هیچ Business logic هنوز آن را صدا نمی‌زند.
   **بدون تغییر (طبق مرز فاز):** rate limiting، cache، CORS سفارشی، رندر مرورگر، LocationPicker، Comparison Mode، اتصال به آدرس فروشگاه.
   **تست:** ۵۰ تست جدید (route-handler، اولین‌بار در پروژه با این الگو — `NextRequest` واقعی + mock کردن `createMapService`/`requireAuth`؛ همه‌ی ۹ کد خطا در `reverse-geocode` کامل پوشش داده شد، بقیه‌ی routeها سبک‌تر). smoke واقعی روی سرور production: درخواست بدون ورود قبل از رسیدن به هر provider با ۴۰۱ رد شد.
11. Address Model — ✅ پیاده‌سازی شد؛ منتظر تأیید. **بدون ساختار موازی**: همان `IAddress` embedded موجود در `User` (طبق تصمیم ۵.۲ `docs/domain-model.md`، بدون تغییر) گسترش یافت، نه یک مدل/کالکشن جدید:
   - **فیلدهای نرمال‌شده‌ی جدید (اختیاری):** `district`, `neighborhood`, `street`, `alley`, `plaque`, `unit`, `deliveryNotes`.
   - **Provenance (اختیاری):** `resolvedBy: {provider, providerPlaceId, resolvedAt}` — فقط اطلاعاتی، منطق کسب‌وکار هرگز به آن وابسته نیست.
   - **`location`** از `{lat,lng}` اختیاری به `{latitude,longitude}` تغییر نام داد (دقیقاً هم‌شکل با `Coordinates` مشترک نقشه) **و اجباری شد** (طبق «مختصات را همیشه ذخیره کن»؛ بی‌خطر چون هنوز هیچ کدی Address نمی‌سازد) — با اعتبارسنجی بازه (±۹۰/±۱۸۰) در سطح Mongoose.
   - **عمداً اضافه نشد:** `formattedAddress` جدا (همان `addressLine` موجود می‌ماند؛ خروجی provider فقط پیش‌پرکن UI است، فاز ۱۳)، `title` جدا (همان `label` موجود کافی است).
   - **ناسازگاری کوچک شناخته‌شده، عمداً دست‌نخورده:** `ICourierProfile.currentLocation` هنوز `{lat,lng}` قدیمی است؛ یکسان‌سازی به فاز Courier موکول شد (خارج از scope این فاز).
   جزئیات کامل استدلال در `docs/domain-model.md` §۸.۱.
   **تست:** ۹ تست جدید/به‌روزشده در `User.test.ts` (آدرس معتبر با همه‌ی فیلدهای جدید، `location` اجباری، بازه‌ی نامعتبر lat/lng، `resolvedBy` معتبر/نامعتبر). `npm run verify` پاس؛ ۳۲۸ تست کل، هیچ تست قبلی خراب نشد.
12. Address API — ✅ پیاده‌سازی شد؛ منتظر تأیید. زیر `/api/v1/addresses` (بدون مدل/کالکشن جدا؛ روی همان `User.addresses` embedded):

   | Route | Method |
   |---|---|
   | `/api/v1/addresses` | GET (فهرست)، POST (ساخت) |
   | `/api/v1/addresses/[id]` | GET، PATCH (partial)، DELETE |
   | `/api/v1/addresses/[id]/default` | POST (پیش‌فرض‌کردن) |

   **امنیت/مالکیت:** همه‌جا `requireAuth` و `userId` فقط از نشست (هرگز از body/param). ownership با یک کوئری واحد `{_id:userId, "addresses._id":id}` enforced می‌شود؛ آدرس کاربر دیگر و آدرس ناموجود هر دو دقیقاً همان ۴۰۴ `ADDRESS_NOT_FOUND` می‌گیرند — هیچ افشایی از وجود/عدم‌وجود آدرس کاربر دیگر نیست.
   **اعتبارسنجی:** `validation/addressSchemas.ts` — از `coordinatesSchema`/`ADDRESS_LABELS` مشترک استفاده می‌کند، دوباره تعریف نکرد. `updateAddressSchema` = `createAddressSchema.partial()`.
   **تصمیم `resolvedBy` (سؤال صریح این فاز):** هرگز از کلاینت پذیرفته نمی‌شود (نه در schema، نه در service) — قابل‌جعل بود. هر آدرس ساخته‌شده از این API امروز `resolvedBy: null` دارد؛ اتصال واقعی به فاز ۱۳ موکول شد (جزئیات استدلال در `docs/domain-model.md` §۸.۲).
   **پیش‌فرض:** فقط «حداکثر یک پیش‌فرض» تضمین شد (نه «همیشه حداقل یک»، تا قانون کسب‌وکاری اختراع نشود). با دو نوشتار متوالی (unset همه → set هدف)، نه تراکنش (Address مالی نیست)؛ عملیات جدا `POST .../default` هم اضافه شد.
   **تست:** ۲۹ تست جدید — ۲۱ تست route-handler (همان الگوی Phase 9؛ عدم‌احراز روی هر ۶ endpoint، اعتبارسنجی، عدم‌درز `userId`/`resolvedBy` کلاینت، خطای غیرمنتظره → ۵۰۰ عمومی) که در `npm run verify` پاس شدند، + ۸ تست یکپارچه‌ی DB واقعی در `addressService.integration.test.ts` (CRUD کامل، across-user 404، id نامعتبر/ناموجود، مختصات نامعتبر، همه‌ی مسیرهای تغییر پیش‌فرض) که مثل فازهای قبلی به‌دلیل محدودیت شبکه‌ی sandbox اجرا نشدند — باید در dev/CI واقعی تأیید شوند.
   **Verification:** `npm run verify` پاس (۳۴۹ تست، lint، typecheck، build). Smoke واقعی روی سرور production: هر ۶ endpoint بدون ورود ۴۰۱ دادند، قبل از هر اتصال DB.
13. MapView / LocationPicker (Frontend) — ✅ پیاده‌سازی شد؛ منتظر تأیید. **قبل از کد**، فرانت‌اند موجود بررسی شد: هیچ کامپوننت نقشه/آدرس، هیچ `mapApi`/`addressApi` کلاینت، و هیچ صفحه‌ی account/address‌ای وجود نداشت (storefront هنوز فقط یک layout خالی دارد). `apiFetch` موجود (`lib/client/apiClient.ts`)، UI primitives (`Button/Card/Skeleton/StateMessage`) و الگوی فرم‌های admin (تست‌شده در فاز ۲) عیناً reuse شدند؛ چیزی دوباره ساخته نشد.

   **معماری:**
   - **`components/map/MapRenderer.ts`** — interface `{center, marker, onMapClick, className}`؛ دقیقاً همان seam که در فاز ۴.۵ (بررسی معماری Rendering-vs-Service) برای `MapRenderingProvider` آینده وعده داده شده بود، نه یک انتزاع دوم.
   - **`components/map/LeafletMapRenderer.tsx`** — پیاده‌سازی واقعی این فاز: **Leaflet + کاشی‌های OpenStreetMap** (بدون کلید، همیشه در دسترس). ⚠️ **این هنوز رندر برندشده‌ی Neshan/Map.ir/Google نیست** — همان تصمیم معلق فاز ۴.۵ («کدام credential برای رندر») هنوز باز است و اینجا حل نشد؛ فقط یک لایه‌ی تعاملی واقعی و تست‌شده جایگزین آن شد تا LocationPicker امروز کار کند. سرویس‌های نقشه (جستجو، reverse-geocode) همچنان از API داخلی واقعی (Neshan/Map.ir/Google پشت `MapService`) می‌آیند — فقط پس‌زمینه‌ی بصری نقشه OSM است.
   - **`components/map/MapView.tsx`** — پوسته‌ی provider-agnostic؛ رندرکننده را با `React.lazy` + `Suspense` (حالت loading) + `MapErrorBoundary` (حالت خطای بارگذاری) بارگذاری می‌کند؛ `renderer` prop برای تست/جایگزینی آینده. هیچ منطق آدرس در آن نیست.
   - **`components/map/LocationPicker.tsx`** — جریان کامل: نقشه + جستجو (debounce ۴۰۰ms + AbortController) + موقعیت فعلی (`useCurrentLocation`) + reverse-geocode + `AddressForm`. حالت‌ها: `idle → resolving → ready/resolve-error`؛ ذخیره با `saving`/`saveError` جدا. حالت خطای reverse-geocode پین را از دست نمی‌دهد (فرم دستی همچنان باز است).
   - **`components/address/AddressForm.tsx`** — فرم خالص، بدون آگاهی از نقشه یا API؛ فقط فیلدهای واقعی `IAddress`.
   - **`lib/client/mapApi.ts` / `lib/client/addressApi.ts`** — wrapperهای نازک روی `apiFetch` (نه یک httpClient دوم). `addressApi.ts` نوع‌های `AddressDto`/`CreateAddressInput`/`UpdateAddressInput` را با `import type` مستقیم از سرور می‌گیرد (type-only، حجم بسته صفر) — تعریف دوباره نشد.
   - **`hooks/useDebouncedValue.ts` / `hooks/useCurrentLocation.ts`** — جدید، عمومی (اولین پوشه‌ی `hooks/` سطح بالا؛ قبلاً hookها کنار کامپوننت بودند).

   **`resolvedBy` (تصمیم صریح این فاز):** فرانت‌اند هرگز آن را در payload نمی‌گذارد — دقیقاً همان تصمیم فاز ۱۱ ادامه پیدا کرد، چیزی جدید حل نشد چون خارج از scope این فاز بود. پس هر آدرسی که از این جریان ساخته شود همچنان `resolvedBy: null` دارد.

   **بدون صفحه‌ی میزبان (تصمیم عمدی scope):** هیچ صفحه‌ی `/account/addresses/...` ساخته نشد — طبق متن صریح این فاز («اگر UI انتخاب آدرس وجود ندارد، حداقل UI reusable لازم را بساز؛ ویژگی‌های نامرتبط checkout/مدیریت‌آدرس در این فاز نه») و چون storefront/account هنوز هیچ auth gate یا layout ندارد (ساختن آن یک feature جدا است، نه بخشی از MapView/LocationPicker). این کامپوننت‌ها reusable و تست‌شده تحویل داده شدند تا فاز بعدی (یا هر فازی که account/checkout را می‌سازد) مستقیم مصرفشان کند.

   **تست (۲۹ تست جدید، همه در `npm run verify` پاس شدند):** `MapView` (۵: renderer تزریقی، مختصات اولیه، بدون marker، کلیک، شکست بارگذاری renderer با `MapErrorBoundary` واقعی)، `LocationPicker` (۱۲: حالت اولیه، انتخاب نقطه→reverse-geocode، شکست reverse-geocode بدون از دست دادن پین، جستجو+انتخاب نتیجه، شکست جستجو، جستجوی خالی بدون فراخوانی API، ویرایش قبل از ذخیره، **ساخت بدون `userId`/`resolvedBy`**، ویرایش آدرس موجود با PATCH — همین تست یک باگ واقعی پیدا کرد: فرم در حالت edit تا کلیک مجدد نقشه نمایش داده نمی‌شد، رفع شد —، شکست ذخیره، دکمه‌ی انصراف)، `AddressForm` (۴)، هوک‌ها (۵)، `mapApi`/`addressApi` (۴)، و **یک تست معماری ایستا** (`provider-independence.test.ts`) که کد واقعی (نه کامنت) هیچ کامپوننت UI را برای نام یک provider اسکن می‌کند و import مستقیم از `lib/server/maps/providers` را ممنوع می‌کند.

   **Verification:** `npm run verify` پاس (۳۸۴ تست کل، lint، typecheck، build). **Smoke واقعی روی مرورگر انجام نشد** (sandbox بدون مرورگر، مثل همه‌ی فازهای قبلی) و چون صفحه‌ی میزبانی هم ساخته نشد، چیز جدیدی برای curl-smoke هم وجود نداشت؛ تأیید این فاز فقط از طریق تست‌های jsdom/RTL بالا و build موفق (خروجی build نشان می‌دهد این کامپوننت‌ها به هیچ صفحه‌ای امروز متصل نیستند، طبق تصمیم عمدی بالا).
14. تا ۱۷. AddressPicker (اتصال به یک صفحه‌ی واقعی)، Routing (کسب‌وکاری)، Comparison، رندر برندشده‌ی Neshan/Map.ir/Google (تصمیم معلق فاز ۴.۵)، تست‌های یکپارچه‌ی DB باقی‌مانده، مستندات نهایی (`docs/maps.md`) — ⏳ شروع نشده.

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

**ENV:** (به‌روز در Phase 13) متغیرهای رندر مرورگر اکنون وجود دارند — بخش «Phase 13» پایین. `NESHAN_API_KEY`/`MAPIR_API_KEY`/`GOOGLE_MAPS_API_KEY` همچنان فقط سمت سرورند و هرگز به کد کلاینت نمی‌رسند.

### Phase 13 — Map Rendering Provider (پیاده‌سازی شد؛ منتظر تأیید کاربر)

- **دو abstraction مستقل:** `MapProvider` (سرور: geocode/search/route) و رندر مرورگر (`MapRendererComponent` در `components/map/MapRenderer.ts` — همان seam موجود تکامل داده شد، interface تکراری ساخته نشد).
- **انتخاب renderer:** فقط `components/map/registry.ts` (`getDefaultMapRenderer()`) بر اساس `NEXT_PUBLIC_MAP_RENDER_PROVIDER` ∈ `leaflet|neshan|google` (پیش‌فرض `leaflet`؛ مقدار نامعتبر → خطا، نه fallback خاموش). `MapView`/`LocationPicker` هیچ نام providerی نمی‌دانند و renderer مشخص را import نمی‌کنند (تست معماری این را enforce می‌کند).
- **Renderer‌های پیاده‌شده:** `LeafletMapRenderer` (OSM؛ **fallback/development رسمی**، حذف نشد)، `NeshanMapRenderer` (پکیج رسمی `@neshan-maps-platform/ol`)، `GoogleMapsRenderer` (`@googlemaps/js-api-loader` v2، `google.maps.Marker` کلاسیک تا Map ID اجباری نباشد). همگی SDK را فقط داخل `useEffect` با `import()` دینامیک بارگذاری می‌کنند (SSR-safe)؛ نبود کلید در render پرتاب می‌شود تا `MapErrorBoundary` بگیرد.
- **Map.ir: عمداً پیاده نشد (deferred).** مستندات رسمیِ قابل‌راستی‌آزمایی برای قرارداد کلیک/مارکر/style پیدا نشد؛ مقدار `mapir` در enum رندر نامعتبر است. تا ارائه‌ی مستندات رسمی حدس زده نمی‌شود.
- **Credentialها:** سرور‌فقط: `NESHAN_API_KEY`، `MAPIR_API_KEY`، `GOOGLE_MAPS_API_KEY`. مرورگر (`NEXT_PUBLIC_*`، در bundle دیده می‌شوند → باید در پنل provider به دامنه/referrer محدود شوند): `NEXT_PUBLIC_NESHAN_MAP_KEY` (نوع «نقشه وب»)، `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`، اختیاری `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`. اعتبارسنجی در `lib/client/mapRenderEnv.ts`.
- **تأیید‌نشده:** رندر واقعی Neshan/Google با کلید واقعی و تست بصری در مرورگر انجام نشد (sandbox مرورگر/کلید ندارد)؛ تست‌ها با mock/بدون سرویس خارجی‌اند. هیچ صفحه‌ی میزبانی هنوز `MapView` را استفاده نمی‌کند، پس build آن را در bundle صفحه‌ای وارد نکرده است.

### Phase 14 — Courier & Delivery Domain (پیاده‌سازی شد؛ منتظر تأیید کاربر)

فقط دامنه/پایداری/سرویس/تست — **هیچ endpoint HTTP، UI، live tracking یا الگوریتم بهینه‌سازی مسیر ساخته نشد.**

- **دو مفهوم جدا (رقیب هم نیستند):** `Order.delivery` = چرخه‌ی تحویل *یک سفارش* (بدون تغییر: `unassigned→assigned→picked_up→proposed→resolved`)؛ `DeliveryRun` = دسته/مسیر *یک پیک* شامل چند سفارش. وضعیت‌های `pending/accepted/in_transit` ساخته نشد.
- **Courier** = همان `User(role=courier)` + `courierProfile` (`vehicleType`، `status: offline|online|busy` = availability موجود). موجودیت جدید ساخته نشد. `courierProfile.currentLocation` دست‌نخورده ماند (فقط «آخرین موقعیت شناخته‌شده»؛ بدون تاریخچه‌ی GPS؛ تصمیم نهایی به فاز Live Tracking).
- **`DeliveryRun`** (`models/DeliveryRun.ts`، کالکشن مستقل): `courierId`، `status: draft|active|completed|cancelled`، `stops[]` (`orderId`، `sequence`، `status: pending|delivered|failed|skipped`، `completedAt`)، `createdByAdminUserId`، زمان‌های چرخه‌ی عمر. **آدرس در stop کپی نمی‌شود** — مقصد همیشه `Order.deliveryAddress` (snapshot). دو سفارش با یک آدرس = دو stop. `currentStop` ذخیره نمی‌شود؛ مشتق است (`getCurrentStop`: run فعال ← کمترین `sequence` ← اولین `pending`).
- **اینورینت‌ها:** `sequence` مرجع ترتیب است (دقیقاً ۱..n، یکتا؛ ترتیب آرایه بی‌معنی؛ خروجی DTO همیشه sort شده). هر سفارش حداکثر در یک stop از یک run. **یک سفارش حداکثر در یک run باز (`draft|active`)**: partial unique index روی `stops.orderId` با `partialFilterExpression: {status: {$in: [draft, active]}}` (نیازمند MongoDB ≥ 6.0)؛ run‌های `completed/cancelled` ارجاع تاریخی نگه می‌دارند. تکرار یک سفارش *داخل یک* run را index نمی‌گیرد → `validateStopSet` (validator مدل + سرویس).
- **ماشین‌های حالت** (`packages/shared/src/domain/delivery.ts`، توابع خالص): run: `draft→active|cancelled`، `active→completed|cancelled`. stop: `pending→delivered|failed|skipped` و همه‌ی وضعیت‌های دیگر پایانی‌اند. خودکار: run با نبودن stop در حالت `pending` `completed` می‌شود. `Order.delivery` با `canActorTransitionOrderDelivery` (بازیگر مجاز هر گذار): تخصیص/آزادسازی/`resolved` فقط admin؛ `picked_up` و `proposed` فقط courier.
- **سرویس** (`services/deliveryRunService.ts`): `createDraftRun`، `activateRun`، `cancelRun` (admin)؛ `confirmPickup`، `reorderStops`، `proposeStopOutcome`، `skipStop` (courier)؛ `getRun`. مالکیت در خود query اعمال می‌شود (run دیگری = ۴۰۴). **reorder** فقط روی run فعالِ *خودِ* پیک؛ باید همه‌ی stopهای `pending` را دقیقاً یک‌بار بیاورد؛ stopهای قفل‌شده سر جایشان می‌مانند؛ یک update اتمیک با شرط «هنوز pending». **outcome:** stop `delivered` → `Order.delivery=proposed` با `proposedOutcome=delivered`؛ stop `failed` → `proposedOutcome=returned` (تنها خروجی غیر-تحویل در چرخه‌ی تأییدشده). پیک **هرگز** `resolved` نمی‌کند و مسیر resolve عمداً در این سرویس نیست (کار admin، فاز Orders). بدون transaction: اتمیک تک‌سند + شرط وضعیت + جبران (compensation).
- **مرز مسیریابی:** `delivery/routePlanner.ts` — `DeliveryRoutePlanner` (interface) + `SequentialRoutePlanner` (بدون بهینه‌سازی، هر leg یک `MapService.getRoute(..., {vehicleType})`) + `buildRoutePlanInput`. `VehicleType` دامنه بی‌تغییر عبور می‌کند؛ نگاشت به provider فقط در adapterها. ژئومتری/فاصله/ETA ذخیره نمی‌شود. کد delivery هیچ provider/کلید/env عمومی‌ای را نمی‌شناسد و `maps/` چیزی از delivery نمی‌داند (تست معماری). `MapService` دست‌نخورده.
- **مرز Live Tracking (فقط طراحی):** موقعیت زنده سرویس جداگانه‌ی آینده است، نه بخشی از run. حریم خصوصی: مشتری فقط اگر `order.userId == خودش` و سفارش در یک run باز باشد؛ پیک فقط runهای خودش؛ admin مدیریت. هیچ endpoint ساخته نشد.
- **API آینده (پیشنهاد، ساخته نشده):** `/api/v1/couriers` (admin)، `/api/v1/delivery-runs` (+`/[id]`، `/[id]/stops` برای reorder، `/[id]/route` → planner).
- **⚠️ ناهمخوانی گزارش‌شده (Decision 5):** قانون «`Order.status → shipped` فقط پس از `assignedAt`» فقط *مستند* است و هیچ‌جا پیاده نشده (سرویس Order وجود ندارد). طبق دستور، DeliveryRun `Order.status` را تغییر نمی‌دهد و قانون جدیدی نساخته است.
- **تصمیم‌های باز (حدس زده نشد):** (۱) آیا یک پیک همزمان چند run فعال می‌تواند داشته باشد؟ (اعمال نشد). (۲) دروازه‌ی availability (`offline` پیک قابل تخصیص است؟) اعمال نشد. (۳) سرنوشت سفارش‌های `picked_up` هنگام لغو run (فعلاً لغو رد می‌شود) و stop `skipped` (سفارش نزد پیک می‌ماند). (۴) `confirmPickup` به‌صورت گام صریح پیک اضافه شد چون `picked_up` در چرخه‌ی موجود لازم بود و هیچ‌جا قابل‌دستیابی نبود — نیاز به تأیید. (۵) race شناخته‌شده: `confirmPickup` هم‌زمان با `cancelRun`.
- **تأییدنشده:** تست‌های یکپارچه با MongoDB واقعی (`deliveryRunService.integration.test.ts`، شامل index جزئی یکتا) نوشته شدند ولی در این sandbox اجرا نشدند؛ رفتار partial index و مسیرهای اتمیک فقط با mock/`validateSync` تست شده‌اند. **باید در dev/CI با `npm run test:integration` تأیید شوند.**
- **هشدار زیرساخت:** `npm test` ریشه فقط workspace `app` را اجرا می‌کند؛ تست‌های `packages/shared` داخل `verify` نیستند. تست‌های قوانین Phase 14 عمداً داخل `app` نوشته شدند تا در `verify` اجرا شوند.

#### به‌روزرسانی Phase 14 — Decision Review، Decision 1 (تأییدشده): Option B

**draft فقط برنامه‌ریزی است و هیچ‌چیزی رزرو نمی‌کند.** این جایگزین رفتار اولیه‌ی Phase 14 (که draft بلافاصله سفارش را assign می‌کرد) شد.

- **ساخت/ویرایش draft** (`createDraftRun`, `addStopToDraft`, `removeStopFromDraft`, `reorderDraftStops`، همه admin-only): **هرگز** `Order.delivery` را نمی‌نویسند. همان سفارش می‌تواند هم‌زمان در چند draft باشد. حذف stop، بقیه را به `۱..n` پیوسته resequence می‌کند؛ حذف آخرین stop رد می‌شود («ماموریت لغو کنید»). ویرایش draft فقط سند run را می‌نویسد.
- **`activateRun` تنها جایی است که سفارش واقعاً assign می‌شود** (`Order.delivery.status=assigned`, `courierId`, `assignedAt = زمان activate`، نه زمان ساخت draft). این عملیات all-or-nothing روی همه‌ی stopهای run است و با **تراکنش واقعی MongoDB** (`mongoose.startSession()` + `session.withTransaction`) پیاده شده — تنها استفاده‌ی transaction در این فایل، چون این تنها عملیاتی است که به «همه یا هیچ» روی چند سند نیاز دارد.
  - **⚠️ محدودیت محیط:** تراکنش نیاز به replica set/mongos دارد. `mongod` مستقل (پیش‌فرض محلی `MONGODB_URI` در `.env.example`، و `MongoMemoryServer` استاندالون‌ای که بقیه‌ی تست‌های یکپارچه استفاده می‌کنند) از تراکنش پشتیبانی نمی‌کند. در این حالت `activateRun` **fallback خاموش به نوشتن غیرتراکنشی نمی‌زند** — عمداً یک `Error` معمولی (نه `AppError`) پرتاب می‌کند تا به‌عنوان باگ/۵۰۰ ثبت شود، طبق طبقه‌بندی مستند در `errors/AppError.ts`. برای اجرای واقعی `activateRun`، MongoDB باید replica set باشد؛ Atlas همیشه همین‌طور است، محیط dev محلی باید تنظیم شود.
  - تست یکپارچه‌ی `activateRun` به همین دلیل از هلپر جدید `models/testDbReplSet.ts` (`MongoMemoryReplSet`, تک‌نود) استفاده می‌کند، جدا از `testDb.ts` استاندالون بقیه‌ی تست‌ها.
- **Index تغییر کرد:** `partialFilterExpression` از `{status:{$in:[draft,active]}}` به `{status:"active"}` (فقط یک برابری ساده، بدون `$in`) تغییر کرد — این هم معنی جدید را درست کد می‌کند و هم نیازمندی MongoDB ≥ 6.0 قبلی را (که فقط برای `$in` در partial filter بود) حذف می‌کند. ثابت مربوطه: `RESERVING_DELIVERY_RUN_STATUS = "active"` در `packages/shared/src/domain/delivery.ts`.
- **`cancelRun` دو مسیر جدا دارد:** لغو یک `draft` هیچ `Order` ای را نمی‌خواند یا نمی‌نویسد (چیزی رزرو نشده بود). لغو یک `active` run دقیقاً همان رفتار قبلی (رد اگر هر سفارشی pickup شده باشد، سپس آزادسازی) را دارد.
- **حل‌شده از فهرست تصمیم‌های باز قبلی:** یک سفارش می‌تواند هم‌زمان در چند draft باشد (تأییدشده)؛ فقط یک run فعال می‌تواند سفارش را داشته باشد؛ activate all-or-nothing است.
- **همچنان باز (خارج از Decision 1، در مرور کلی گزارش شد):** معنی `picked_up`/`confirmPickup` (حل‌شد — پایین)، مالک `Order.status=shipped`، سرنوشت لغو run بعد از pickup، معنی `skipped`، سقف تعداد run فعال هر پیک، دروازه‌ی availability پیک آفلاین، و race بین `confirmPickup` و `cancelRun` — هیچ‌کدام در این تغییر دست نخورده‌اند.

#### به‌روزرسانی Phase 14 — Decision Review، Decision 2 (تأییدشده): معنای `picked_up`

**`assigned` و `picked_up` دو رویداد جدا هستند، نه یک چیز با دو اسم.** رفتار کد همان چیزی ماند که بود (فقط مستندسازی روشن شد؛ هیچ گذار/enum/مجوزی تغییر نکرد):

- **`assigned`** = تخصیص رسمی توسط فعال‌سازی ادمین (`activateRun`، Decision 1)؛ `assignedAt`. همان لحظه‌ای که «تأیید ادمین» در `[PI §8]` به آن اشاره دارد.
- **`picked_up`** = پیک فیزیکاً کالا را از فروشگاه/انبار تحویل گرفته؛ `pickedUpAt` (زمان واقعی تأیید، نه زمان تخصیص). در این فاز فقط ثبت می‌شود؛ مبنای هیچ گزارش/سنجش عملکردی نیست.
- گذار `assigned→picked_up` همیشه با اقدام صریح پیک (`confirmPickup`) است — هرگز ضمنی از طریق `proposeStopOutcome`، reorder یا فعال‌سازی. `proposeStopOutcome` همچنان `picked_up` می‌خواهد، نه صرفاً `assigned`.
- مستندات کامل‌تر در `docs/domain-model.md §4` و کامنت‌های `IOrderDelivery` (`Order.ts`) و `ORDER_DELIVERY_TRANSITIONS` (`packages/shared/src/domain/delivery.ts`).
- **همچنان باز:** مالک `Order.status=shipped` (Decision 3، حل‌شد — پایین)، لغو run بعد از pickup (Decision 6)، معنی `skipped`، سقف run فعال هر پیک، availability پیک آفلاین، race بین `confirmPickup` و `cancelRun`.

#### به‌روزرسانی Phase 14 — Decision Review، Decision 3 (تأییدشده): مالکیت `Order.status` به فاز Orders موکول شد (Option F)

**دلیل:** ماژول رسمی Orders (سرویس/API/چرخه‌ی ثبت-ویرایش-لغو سفارش) هنوز در ریپو پیاده نشده؛ تعیین trigger/بازیگر `Order.status` بدون آن حدسی خواهد بود.

- **`DeliveryRun` هرگز `Order.status` را نمی‌نویسد** — نه در `createDraftRun`, `addStopToDraft`, `removeStopFromDraft`, `reorderDraftStops`, `activateRun`, `confirmPickup`, `proposeStopOutcome`, `skipStop`, و نه در `cancelRun`. این یک invariant صریح است و با یک تست اختصاصی (`deliveryRunService.test.ts`, describe «Decision 3») روی همه‌ی نوشتن‌های `Order` بررسی می‌شود: هر `$set`/`$unset` فقط می‌تواند فیلدهای `delivery.*` را داشته باشد.
- **بند مستند «`shipped` فقط پس از `assignedAt`» یک گارد است، نه trigger.** یعنی بدون `assignedAt`، `shipped` ممکن نیست؛ اما ست‌شدن `assignedAt` خودکار `shipped` نمی‌سازد.
- **عمداً حل‌نشده و به فاز Orders موکول شد:** مالک `Order.status`، trigger دقیق `shipped` (فعال‌سازی؟ pickup؟ پیشنهاد پیک؟)، بازیگر مجاز آن، trigger `shipped→returned` و `shipped→delivered`، و سیاست دقیق `cancelled`.
- **هیچ ماشین‌حالتی برای `Order.status` اضافه نشد** (نه `ORDER_STATUS_TRANSITIONS`، نه actor جدید) — طبق تصمیم، این کار عمداً نیمه‌کاره پیاده نمی‌شود.
- `Order.status` و `Order.delivery.status` دو زیرسیستم کاملاً مستقل باقی می‌مانند؛ هیچ همگام‌سازی ضمنی بین‌شان معرفی نشد.

#### به‌روزرسانی Phase 14 — Decision Review، Decision 4 (تأییدشده): حداکثر یک run فعال برای هر پیک

- **یک پیک می‌تواند هر تعداد run در وضعیت `draft` داشته باشد (بدون تغییر نسبت به Decision 1)، ولی حداکثر یک run در وضعیت `active`.** run فعال باید `completed` یا `cancelled` شود تا run بعدیِ همان پیک بتواند فعال شود.
- **قید در سطح دیتابیس است، نه فقط چک سرویس:** ایندکس یکتای جزئی جدید `{courierId:1}` با `partialFilterExpression:{status:"active"}` در `models/DeliveryRun.ts` (کنار ایندکس مشابه سطح سفارش از Decision 1؛ هر دو از یک الگو و همان ثابت `RESERVING_DELIVERY_RUN_STATUS="active"` استفاده می‌کنند — بدون نیاز به `$in`، پس بدون نیازمندی MongoDB ≥ 6.0). ایندکس معمولی موجود `{courierId,status}` برای فهرست‌کردن runهای یک پیک دست‌نخورده ماند.
- **`activateRun`** یک پیش‌بررسی سریع داخل همان تراکنش دارد (`DeliveryRun.exists({courierId,status:"active"})` با همان session) تا خطای واضح بدهد، **اما این پیش‌بررسی مرجع نیست** — مرجع نهایی همان ایندکس یکتاست؛ خطای duplicate-key روی این ایندکس هم گرفته و به همان کد خطا تبدیل می‌شود (`duplicateKeyIndexField` تشخیص می‌دهد کدام ایندکس نقض شده: `courierId` یا `stops.orderId`).
- **کد خطا:** `COURIER_ALREADY_HAS_ACTIVE_RUN` (409). تلاش دوم بدون هیچ نوشتن جزئی رد می‌شود (all-or-nothing از Decision 1 حفظ شد).
- **دست‌نخورده ماند:** `courierProfile.status`/availability (Decision 5، حل‌شد — پایین)، معنای `skipped`، سیاست لغو بعد از pickup (Decision 6)، و مالکیت `Order.status` (Decision 3).

#### به‌روزرسانی Phase 14 — Decision Review، Decision 5 (تأییدشده): availability پیک به فاز رسمی Courier موکول شد

- **`courierProfile.status` (`offline|online|busy`) هیچ اثری روی `DeliveryRun` ندارد.** `createDraftRun` فقط `role="courier"` و `isActive=true` را چک می‌کند (نه `courierProfile.status`). `activateRun` اصلاً سند `User` را نمی‌خواند.
- **هیچ همگام‌سازی خودکاری معرفی نشد** — نه `active DeliveryRun → busy`، نه `completed/cancelled → online`، و نه جهت معکوس آن‌ها. دو زیرسیستم کاملاً مستقل باقی می‌مانند (همان الگوی Decision 3 برای `Order.status`/`Order.delivery`).
- **`User.isActive` مستقل از `courierProfile.status` ماند** و تنها دروازه‌ی eligibility حساب باقی است.
- **قید Decision 4 («حداکثر یک run فعال»، ایندکس یکتای جزئی روی `courierId`) دست‌نخورده و کاملاً مستقل از `courierProfile.status` ماند** — `busy` جایگزین یا معادل آن قید نشد.
- **هیچ کد، endpoint، enum یا فیلد جدیدی اضافه نشد** — این یک تصمیم مرزی/مستندسازی محض بود؛ مالکیت و قوانین گذار `courierProfile.status` به فاز رسمی Courier موکول شد.

#### به‌روزرسانی Phase 14 — Decision 6 (تأییدشده و پیاده‌سازی‌شده): Emergency Cancel + سفارش جایگزین

**مدل جدید:** `DeliveryRunEmergencyCancelRequest` (`models/DeliveryRunEmergencyCancelRequest.ts`) — `deliveryRunId, requestedByCourierId, reason, status(pending|approved|rejected), requestedAt, reviewedByAdminUserId, reviewedAt, rejectionReason, replacementOrderIds[], physicalReturn?{returned,recordedByAdminUserId,recordedAt}`. ایندکس یکتای جزئی `{deliveryRunId}` با `partialFilterExpression:{status:"pending"}` (الگوی دقیق Decision 1/4، بدون `$in`، بدون نیازمندی MongoDB≥6.0): حداکثر یک درخواست در انتظار برای هر run.

**enum/گذار جدید (فقط `Order.delivery`، نه `Order.status`):** `ORDER_DELIVERY_STATUSES` یک مقدار گرفت: `"emergency_cancelled"`. گذار `picked_up→emergency_cancelled`، فقط admin، فقط از طریق تأیید (`packages/shared/src/domain/delivery.ts`). افزوده‌ی موازی `Order.delivery.emergencyCancelledAt`. روی `Order` فیلد `replacesOrderId` (یک‌طرفه، فقط روی سفارش جایگزین، sparse index) اضافه شد. `OrderCounter.getNextOrderNumber(session?)` یک پارامتر اختیاری `session` گرفت تا در تراکنش تأیید شرکت کند (بدون تغییر رفتار برای فراخوان‌های موجود).

**سرویس:** `services/emergencyCancelService.ts` — `requestEmergencyCancel` (courier-only, فقط run فعال خودش, نیازمند حداقل یک سفارش `picked_up`, بدون نوشتن روی run/سفارش)، `reviewEmergencyCancelRequest` (admin-only؛ رد = یک نوشتن شرطی؛ تأیید = **تنها عملیات تراکنشی این فایل**، دقیقاً الگوی `activateRun`: claim درخواست → cancel کردن run → برای هر stop، **بر اساس وضعیت واقعی سفارش در لحظه‌ی نوشتن** (نه خواندن قبل از تراکنش): `picked_up→emergency_cancelled`+ساخت سفارش جایگزین، یا `assigned→unassigned` (آزادسازی)، یا دست‌نخورده اگر جای دیگری رفته باشد)، `recordPhysicalReturn` (admin-only، فقط روی درخواست تأییدشده، کاملاً اطلاعاتی)، `getEmergencyCancelRequest` (مالکیت: ادمین هرکدام، پیک فقط خودش).
- **Idempotency:** تکرار همان تصمیم روی یک درخواست پایانی = no-op بی‌اثر (بدون سفارش جایگزین دوم، بدون audit دوم)؛ تصمیم متناقض روی وضعیت پایانی = تعارض واقعی (`EMERGENCY_CANCEL_ALREADY_REVIEWED`).
- **محیط تراکنش:** دقیقاً همان محدودیت `activateRun` (نیاز به replica set؛ بدون fallback غیرتراکنشی؛ خطای `Error` معمولی نه `AppError`). دو تابع کمکی `isDuplicateKeyError`/`isTransactionsUnsupportedError` از `deliveryRunService.ts` export شدند تا دوباره استفاده شوند (بدون انتزاع تراکنش دوم).
- **مالی:** `isPaid`/زمان پرداخت هرگز به سفارش جایگزین کپی نمی‌شوند (سیستم فقط COD است؛ پولی برای اصلی هرگز گرفته نشده بود) — بدون سیستم پرداخت/بازپرداخت جدید.
- **اولویت/انبار:** عمداً پیاده نشد؛ `replacesOrderId` به‌تنهایی برای شناسایی بعدی کافی است (طبق تصمیم).
- **`cancelRun` عادی دست‌نخورده ماند** — همچنان بعد از هر pickup رد می‌شود؛ Emergency Cancel تنها مسیر بازیابی است.
- **API:** `POST /api/v1/delivery-runs/[id]/emergency-cancel` (courier)، `GET /api/v1/emergency-cancel-requests/[id]`، `POST .../review`، `POST .../physical-return` (admin). الگوی `requireAuth`/`requireAdmin` + `parseJsonBody` + `apiResponse` موجود، بدون سبک جدید.
- **Audit:** از `AuditLog` موجود استفاده شد (بدون مکانیزم دوم) — `action`های: `deliveryRun.emergency_cancel_requested/approved/rejected/physical_return_recorded`, `order.created_as_replacement`.

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
