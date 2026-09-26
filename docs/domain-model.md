# طراحی مدل دامنه — Persboy (فاز ۲: Domain & Contracts)

> وضعیت این سند: **پیاده‌سازی‌شده** — Mongoose Schemaها طبق این تحلیل نوشته و تست شدند
> (`app/src/lib/server/models/`). جزئیات وضعیت تست در §۸ و در `CLAUDE.md`.

منابع بررسی‌شده: `PROJECT-INSTRUCTIONS.md`، `MASTER-PROMPT.md`، سند «Domain Modeling & Database
Foundation»، ریپوی Legacy (`persboy/fruit-veg-store-backend` — ۲۶ مدل Mongoose بازرسی شد)،
ریپوی Target (`persboy/fruitland` — وضعیت فعلی: فاز ۱ کامل، `CLAUDE.md` و `docs/legacy-phase1/`).

---

## ۱. فیلتر اصلی: چه‌چیزی از Legacy وارد این فاز می‌شود؟

Legacy یک سیستم آنلاین‌پرداخت کامل (ZarinPal) و کیف‌پول/رفرال کاملاً حسابداری‌شده دارد. اما طبق
`PROJECT-INSTRUCTIONS.md`:

- **پرداخت:** فقط «پرداخت درب منزل» تأیید شده؛ پرداخت آنلاین ماژول آینده است.
- **کیف پول:** قوانین حسابداری هنوز نیاز به تأیید دارد.
- **رفرال:** فرمول پاداش نهایی نشده.
- **احراز هویت:** استراتژی OTP/Token/Session هنوز تأیید نشده.

بنابراین مدل‌های زیر از Legacy **آگاهانه حذف/به‌تعویق افتادند** (نه فراموش‌شده — مستندشده):

| مدل Legacy | دلیل حذف در این فاز |
|---|---|
| `OrderPaymentSession`, `PhoneOrderPaymentLink` | کاملاً وابسته به درگاه آنلاین (ZarinPal) — ماژول آینده |
| `WalletWithdrawal`, `WalletPhonePaymentVerification` | وابسته به تسویه/پرداخت آنلاین کیف‌پول |
| `WalletSettings`, `ReferralSettings` | پارامترهای فرمول‌هایی که هنوز تأیید نشده‌اند |
| `Otp`, `RefreshToken` | وابسته به استراتژی احراز هویت که هنوز تأیید نشده (بخش ۱۸ Master Prompt) |

این‌ها «فراموش نشده‌اند» — در بخش ۷ (سؤالات باز) دوباره فهرست شده‌اند تا در فاز مربوطه بدون
باز-طراحی از صفر اضافه شوند.

---

## ۲. فهرست موجودیت‌های دامنه (منجمد برای این فاز)

| مدل | هدف | مالک داده | چرخه‌ی عمر | کالکشن مستقل؟ |
|---|---|---|---|---|
| **User** | مشتری/ادمین/پیک با فیلد `role` | خودش | فعال ↔ غیرفعال | بله |
| Address *(subdoc)* | آدرس‌های کاربر (فیلدهای نرمال‌شده‌ی نقشه، Phase 4.5 مرحله‌ی ۱۰) | User | ندارد | نه — Embedded در User |
| CourierProfile *(subdoc)* | وضعیت/وسیله‌ی پیک | User (role=courier) | آفلاین↔آنلاین↔مشغول | نه — Embedded در User |
| **SystemState** | تعیین اتمیک اولین کاربر = MASTER_ADMIN | سیستم | Singleton | بله |
| **Category** | دسته‌بندی محصول (قابل‌مدیریت در ادمین) | Admin | فعال↔غیرفعال، ترتیب | بله |
| **Product** | کالای فروشگاه | Admin | فعال↔غیرفعال | بله |
| ProductVariant *(subdoc)* | واحد فروش + قیمت + موجودی | Product | ندارد | نه — Embedded در Product |
| **Order** | سفارش مشتری/تلفنی | User (customer) | preparing→shipped→delivered/cancelled/returned | بله |
| OrderItem *(subdoc)* | آیتم سفارش (Snapshot قیمت/نام) | Order | ندارد | نه — Embedded |
| OrderDelivery *(subdoc)* | تخصیص/تحویل پیک | Order | assigned→pickedUp→resolved | نه — Embedded |
| **OrderCounter** | شمارنده‌ی اتمیک شماره‌ی سفارش | سیستم | Singleton | بله |
| **DiscountCode** | کد تخفیف عمومی/شخصی | Admin | فعال↔غیرفعال، مصرف‌شده | بله |
| **Review** | نظر مشتری روی محصولِ سفارشِ تحویل‌شده | User | ثابت پس از ثبت | بله |
| **ReviewAttribute** | تعریف ویژگی قابل‌امتیازدهی (تازگی، شیرینی...) | Admin | فعال↔غیرفعال | بله |
| **Notification** | اعلان پنل ادمین | سیستم | خوانده‌نشده↔خوانده‌شده | بله |
| **AuditLog** | لاگ عملیات حساس ادمین | سیستم | Append-only | بله |
| **StoreSettings** | اطلاعات فروشگاه | Admin | Singleton | بله |
| **ShippingSettings** | هزینه‌ی ارسال / آستانه‌ی رایگان | Admin | Singleton | بله |
| **SiteContent** | محتوای ثابت سایت (درباره‌ما، شرایط...) | Admin | Singleton | بله |
| **FaqItem** | سؤال متداول | Admin | ترتیب‌پذیر | بله |
| **HomepageSlide** | اسلاید صفحه‌ی اصلی | Admin | ترتیب‌پذیر | بله |

**تغییر آگاهانه نسبت به Legacy:** `Category` در Legacy فقط یک enum ثابت
(`fruit/vegetable/produce/organic`) بود که با فلگ `isOrganic` هم‌پوشانی مفهومی داشت («organic»
هم دسته بود هم صفت). چون نقشه‌ی راه (بخش ۳۹ Master Prompt) صفحه‌ی مستقل «دسته‌بندی‌ها» در ادمین
دارد، Category به یک کالکشن واقعی تبدیل شد و `isOrganic` فقط یک صفت محصول باقی می‌ماند. این یک
تصمیم مهندسی روتین است (نه تغییر قانون کسب‌وکار) — طبق بخش ۴۳ اجازه‌ی تصمیم‌گیری بدون توقف را دارد.

---

## ۳. نمودار روابط

```
User ──< Order (userId)
User ──< Review (userId)
User ──< DiscountCode (ownerUserId, فقط type=personal)
User ──< AuditLog (adminUserId)
User ──< Notification  (بدون رابطه‌ی مستقیم — سراسری برای پنل ادمین)
User ──(referredByUserId)── User   [خودارجاع — فقط شناسایی، بدون فرمول پاداش]

Category ──< Product (categoryId)
Product ──< OrderItem (productId, Snapshot)
Product ──< Review (productId)
Product >── ReviewAttribute (reviewAttributes: key[])

Order ──< OrderItem (Embedded)
Order ──(courierId)── User
Order ──(createdByAdminUserId)── User   [فقط سفارش تلفنی]
Order ──< Review (orderId)
Order ── OrderCounter (تولید orderNumber)
Order ── DiscountCode (code — ارجاع متنی، نه ObjectId؛ دلیل در بخش ۵)
```

---

## ۴. ماشین‌های حالت

### Order.status
```
preparing → shipped → delivered
preparing → cancelled
shipped   → returned
```
- انتقال به `shipped`: فقط پس از `delivery.assignedAt` ست‌شدن (تخصیص پیک).
- انتقال به `delivered`/`returned`: فقط با تأیید نهایی ادمین (طبق بخش ۸ Project Instructions:
  «تأیید نهایی تحویل/عودت با ادمین است»)، نه صرفاً ادعای پیک.
- `cancelled`: فقط از `preparing` مجاز است (سفارشِ درحال ارسال را نمی‌توان مستقیم کنسل کرد —
  این یک قانون کسب‌وکار حدس‌زده‌شده نیست، بلکه پیش‌فرض ایمن؛ **سؤال باز**، نگاه کنید بخش ۷).

### Order.delivery (زیرسیستم مستقل از status)
```
(خالی) → assignmentRequested → assigned → pickedUp → proposed(delivered|returned) → resolved
```
انتقال آخر (`resolved`) فقط توسط ادمین انجام می‌شود؛ لحظه‌ی `resolvedAt` مبنای گزارش عملکرد پیک است.

### DiscountCode
```
active ⇄ inactive   (دستی توسط ادمین)
active → expired     (خودکار، بر اساس expiresAt)
active → exhausted    (خودکار، usedCount == maxUsage)
```

### User.role
تغییر نقش فقط توسط MASTER_ADMIN و فقط برای ارتقا/تنزل ADMIN↔CUSTOMER؛ MASTER_ADMIN هرگز از طریق
API قابل‌تغییر/تفویض نیست (طبق بخش ۱۷ Master Prompt).

---

## ۵. تصمیمات کلیدی طراحی (با استدلال)

1. **User واحد برای هر سه نقش** — طبق بخش ۱۸ سند مدل‌سازی؛ داده‌ی اختصاصی پیک (`courierProfile`)
   Embedded است چون فقط یک نقطه‌ی موقعیت فعلی نگه می‌داریم، نه تاریخچه‌ی GPS.
2. **Address Embedded در User، ولی Snapshot در Order** — آدرس فعلی کاربر برای نمایش/ویرایش
   Embedded می‌ماند؛ اما هر سفارش یک کپی مستقل از آدرس در لحظه‌ی ثبت نگه می‌دارد تا ویرایش بعدی
   آدرس، فاکتورهای قبلی را عوض نکند (بخش ۱۹ سند مدل‌سازی).
3. **OrderItem همیشه Snapshot** — نام/قیمت/تصویر محصول در لحظه‌ی خرید کپی می‌شود؛ `productId`
   فقط برای لینک «مشاهده‌ی محصول» نگه داشته می‌شود و منبع قیمت تاریخی نیست.
4. **DiscountCode با ارجاع متنی (`code`) نه ObjectId در Order** — چون کد تخفیف پس از استفاده هم
   باید در فاکتور «همان‌طور که بود» قابل نمایش بماند و تغییر بعدی رکورد تخفیف نباید تاریخچه را
   بشکند؛ خودِ درصد/مبلغ تخفیف اعمال‌شده هم در Order Snapshot می‌شود (`discountAmount`).
5. **پرداخت ساده‌سازی‌شده در Order** — چون فقط COD تأیید شده، به‌جای زیرسند پیچیده‌ی
   `payment{method, walletAmount, onlineAmount, codAmount, isPaid}` (که در Legacy برای
   چندروشی بودن لازم بود)، فقط دو فیلد ساده: `isPaid: boolean` و `paidAt: Date|null`.
   **این طراحی عمداً باز گذاشته شده** تا وقتی پرداخت آنلاین تأیید شد، بدون شکستن Order موجود،
   یک زیرسند `payment` جایگزین این دو فیلد شود (تغییر جمع‌شونده، نه بازنویسی).
6. **بدون Refund model در این فاز** — چون بدون پرداخت آنلاین، «بازگشت وجه» یعنی صرفاً عدم
   دریافت وجه نقد؛ چیزی برای مدل‌سازی مالی نیست. اگر Return منجر به تعهد مالی به مشتری شود
   (که در حال حاضر تعریف نشده)، جزو سؤالات باز است.
7. **customerCode (کد ۵ رقمی)** — فیلد جدید روی User، مطابق بخش ۱ Project Instructions
   («شناسایی مشتری با کد ۵ رقمی یا شماره تلفن» برای سفارش تلفنی). تولید: عدد تصادفی ۵ رقمی +
   `unique index` + retry در تصادم (نه شمارنده‌ی ترتیبی، چون نیازی به توالی نیست) — این یک
   جزئیات پیاده‌سازی روتین است، نه قانون کسب‌وکار.
8. **بدون TelephoneOrder جدا** — طبق بخش ۲۵ سند مدل‌سازی، از همان Order با `source:"phone"` و
   `createdByAdminUserId` استفاده می‌شود؛ موجودیت جدا توجیه ندارد.
9. **Review و ReviewAttribute جدا نگه داشته شدند** — یکی داده (نظر واقعی مشتری)، دیگری تعریف
   (فهرست ویژگی‌های قابل‌امتیازدهی که ادمین مدیریت می‌کند)؛ چرخه‌ی عمر و مالکیت متفاوت دارند.
10. **AuditLog عمومی از همان ابتدا** — چون حداقل یک نیاز تأییدشده دارد (تغییر تاریخ تولد توسط
    ادمین، بخش ۱۷ Master Prompt) و طراحی‌اش طوری است که بدون تغییر ساختار برای موارد آینده
    (اصلاح موجودی، تغییر نقش) هم قابل‌استفاده مجدد باشد.

---

## ۶. برنامه‌ی ایندکس

| کالکشن | ایندکس | نوع Query که پشتیبانی می‌کند | یکتا؟ |
|---|---|---|---|
| User | `phone` | ورود/جست‌وجوی کاربر | بله |
| User | `customerCode` | شناسایی سفارش تلفنی | بله (sparse) |
| User | `referralCode` | اعتبارسنجی کد دعوت | بله (sparse) |
| Category | `slug` | صفحه‌ی دسته‌بندی storefront | بله |
| Product | `{category, isActive}` | لیست محصولات یک دسته | خیر |
| Product | `name` (text) | جست‌وجوی محصول | خیر |
| Order | `{userId, createdAt:-1}` | تاریخچه‌ی سفارش‌های مشتری | خیر |
| Order | `{status, createdAt:-1}` | صف عملیاتی ادمین | خیر |
| Order | `{courierId, status}` | سفارش‌های فعال یک پیک | خیر |
| Order | `orderNumber` | جست‌وجوی سفارش با شماره‌ی نمایشی | بله |
| DiscountCode | `code` | اعتبارسنجی کد در چک‌اوت | بله |
| Review | `{orderId, productId}` | جلوگیری از نظر تکراری روی یک خرید | بله |
| Review | `{productId, createdAt:-1}` | نظرات/آمار کیفیت یک محصول | خیر |
| AuditLog | `{entityId, createdAt:-1}` | تاریخچه‌ی یک رکورد خاص | خیر |

---

## ۷. سؤالات باز (طبق بخش ۹ Project Instructions — حدس زده نشده‌اند)

این‌ها **مانع پیاده‌سازی مدل‌های منجمدشده‌ی بالا نیستند**، ولی باید قبل از فاز/فیچر مربوطه تأیید شوند:

1. **احراز هویت** — OTP expiration/retry، استراتژی Token/Session، Refresh. مدل‌های `Otp` و
   `RefreshToken` عمداً در این فاز طراحی/منجمد نشدند.
2. **کیف پول** — آیا اصلاً در نقشه‌ی راه فعلی (پیش از پرداخت آنلاین) لازم است؟ اگر بله، مدل
   Ledger (`Wallet` + `WalletTransaction`، به سبک Legacy: `balance` فقط Cache، تراکنش منبع
   حقیقت) به‌عنوان الگوی پیشنهادی آماده است ولی تا تأیید قوانین حسابداری پیاده‌سازی نمی‌شود.
3. **رفرال** — فرمول پاداش نهایی نشده. `User.referralCode`/`referredByUserId` (فقط شناسایی
   رابطه، نه پاداش) در مدل User گنجانده شده چون بی‌ضرر و برگشت‌ناپذیر نیست؛ اما تولید خودکار
   کد تخفیف پاداش و `ReferralSettings` به‌تعویق افتاد.
4. آیا کنسل‌کردن سفارش پس از `shipped` باید اصلاً ممکن باشد (فعلاً غیرمجاز فرض شده)؟
5. آیا «گزارش کیفیت محصول» (بخش ۴۰ Master Prompt) یک ورک‌فلوی جدا از Review است یا همان Review
   کافی است؟ (فعلاً یکی فرض شده — نیاز به تأیید در فاز Reviews/Quality.)
6. آیا بازگشت وجه سفارش‌های COD نیاز به رکورد مالی مستقل دارد یا کاملاً دستی/خارج از سیستم است؟

---

## ۸. وضعیت پیاده‌سازی

| بخش | وضعیت |
|---|---|
| تحلیل دامنه | ✅ انجام شد |
| فهرست موجودیت + روابط | ✅ انجام شد |
| ماشین‌های حالت | ✅ انجام شد |
| برنامه‌ی ایندکس | ✅ انجام شد |
| مشخصات فیلد به فیلد (Zod + Mongoose) | ✅ Mongoose انجام شد (۱۶ مدل)؛ Zod DTO سبک نگه داشته شد — قراردادهای ورودی هر route در فاز پیاده‌سازی همان صفحه نوشته می‌شود |
| پیاده‌سازی Schema واقعی | ✅ انجام شد — `app/src/lib/server/models/` |
| تست‌های مدل | ✅ ۵۳ تست schema-validation (بدون DB) پاس؛ ⚠️ تست‌های یکپارچه‌ی واقعی (`test:integration`) نوشته شدند ولی به‌دلیل محدودیت شبکه‌ی sandbox اجرا نشدند — باید در dev/CI واقعی تأیید شوند |
| Commit/Push | ✅ این کامیت |

### ۸.۱ به‌روزرسانی Address (Maps Phase 4.5، مرحله‌ی ۱۰)

`IAddress` (embedded در User، بدون تغییر ساختار کلی — طبق تصمیم ۵.۲ بالا) این فیلدها را گرفت:
`district`, `neighborhood`, `street`, `alley`, `plaque`, `unit` (همه اختیاری، رشته‌ای)، `deliveryNotes` (اختیاری)،
`resolvedBy: {provider, providerPlaceId, resolvedAt}` (اختیاری، فقط provenance — منطق کسب‌وکار هرگز آن را نمی‌خواند).

`location` (قبلاً اختیاری `{lat,lng}`) به `{latitude,longitude}` تغییر نام داد (دقیقاً همان shape با `Coordinates`
مشترک در `lib/server/maps`) **و اجباری شد** — طبق قانون صریح پرامپت نقشه «مختصات را همیشه ذخیره کن»؛ چون هنوز
هیچ کدی سند Address نمی‌سازد، تغییر بی‌خطر بود. اعتبارسنجی بازه (±۹۰/±۱۸۰) در سطح Mongoose هم اضافه شد.

**عمداً اضافه نشد (برای جلوگیری از ساختار موازی):**
- `formattedAddress` جدا — همان `addressLine` موجود تنها متن نهایی و قابل‌ویرایش آدرس می‌ماند؛ `formattedAddress`
  خروجی provider فقط برای پیش‌پرکردن اولیه‌ی `addressLine` در UI انتخاب‌گر استفاده می‌شود (فاز ۱۳ نقشه)، ذخیره نمی‌شود.
- `title` جدا — همان `label` (enum `home/work/other`) موجود همین نقش را دارد.

⚠️ **ناسازگاری کوچک شناخته‌شده (خارج از این فاز، دست نخورد):** `ICourierProfile.currentLocation` هنوز
`{lat,lng}` قدیمی است، نه `{latitude,longitude}`. یکسان‌سازی آن به فاز Courier/Tracking موکول شد چون خارج از
scope مدل Address بود (MASTER-PROMPT §۳۶: بدون تغییر بی‌ربط).

### ۸.۲ Address API (Maps Phase 4.5، مرحله‌ی ۱۱)

CRUD کامل روی همان `User.addresses` embedded (بدون مدل یا کالکشن جدا)، زیر `/api/v1/addresses` (شبیه‌ی
`/api/v1/auth/me`: منبعی که مالکیتش از نشست گرفته می‌شود، نه از پارامتر). مالکیت **همیشه** با ترکیب
`{_id: userId, "addresses._id": addressId}` در همان کوئری enforced می‌شود — هیچ مسیر جداگانه‌ای برای «آیا
این آدرس اصلاً وجود دارد» نیست، پس هرگز وجود آدرس کاربر دیگر لو نمی‌رود؛ آدرس متعلق به کاربر دیگر و آدرس
ناموجود هر دو دقیقاً همان ۴۰۴ یکسان (`ADDRESS_NOT_FOUND`) می‌گیرند.

**تصمیم `resolvedBy` (سؤال صریح این فاز):** هیچ‌کدام از create/update آن را از کلاینت نمی‌پذیرند — اگر
پذیرفته می‌شد، هر کاربری می‌توانست بدون هیچ فراخوانی واقعی MapService ادعا کند «این آدرس را Google/Neshan
تأیید کرده»، که دقیقاً یعنی provenance قابل‌جعل. پس امروز هر آدرسی که از این API ساخته شود `resolvedBy: null`
دارد. اتصال واقعی (که فرانت‌اند بعد از صدا زدن `/api/v1/maps/reverse-geocode` در فاز ۱۳ چطور نتیجه را به‌طور
قابل‌اعتماد به create/update برساند) هنوز طراحی نشده و باید در فاز ۱۳ تصمیم‌گیری شود.

**تصمیم پیش‌فرض (invariant):** فقط «حداکثر یک پیش‌فرض» تضمین شده — طبق متن دقیق این فاز («cannot accidentally
contain multiple defaults»)، نه «همیشه حداقل یک پیش‌فرض». ساخت اولین آدرس بدون `isDefault` آن را خودکار
پیش‌فرض نمی‌کند؛ این یک قانون کسب‌وکاری اختراع‌نشده است. عملیات جدا `POST /addresses/[id]/default` هم اضافه
شد. پیاده‌سازی با دو نوشتار متوالی روی همان سند (unset همه، سپس set هدف) است، نه تراکنش — چون Address مالی
یا سفارش نیست (MASTER-PROMPT §۳۰ فقط برای پول/موجودی/وضعیت سفارش تراکنش می‌خواهد)، ولی یک بازه‌ی رقابتی
نظری کوچک بین دو درخواست هم‌زمان شناخته‌شده و مستند است.

**جزئیات کامل در `CLAUDE.md`.**
