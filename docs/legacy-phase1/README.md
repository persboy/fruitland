# یادداشت مرجع — ریپوی Legacy

منبع: `persboy/fruit-veg-store-backend` (read-only، هرگز پوش نمی‌شود).

## یافته‌های کلیدی (فاز ۰)

- اپ Next.js مونولیتیک با ۱۴۳ روت API داخلی (نه Express).
- ماژول‌های پیاده‌سازی‌شده: Auth (JWT + OTP + Refresh)، Wallet، Referral، Discount Codes، Orders، Telephone Orders، Products، Reviews، Addresses، Admin/Courier permissions.
- سرویس‌های خارجی پشت adapter: Neshan (نقشه)، Cloudinary (تصویر)، ZarinPal (Sandbox)، Pusher (Realtime)، sms.ir (OTP).
- README ریپو قدیمی/نادرست است (ادعای «فاز ۱ فقط Mock» دارد در حالی که کد واقعی و متصل به MongoDB است) — به آن اعتماد نکنید، به کد واقعی مراجعه کنید.
- تست: Jest (unit + api) با mongodb-memory-server.

## نحوه‌ی استفاده در این پروژه

این ریپو فقط برای درک قوانین کسب‌وکار، واژگان دامنه، و edge caseهای قبلاً کشف‌شده بررسی می‌شود؛ معماری آن (مثلاً ساختار دقیق مدل‌ها یا نام‌گذاری‌ها) کورکورانه کپی نمی‌شود. هر رفتار قبل از پیاده‌سازی مجدد ارزیابی می‌شود.
