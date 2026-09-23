import { AppError } from "../../errors/AppError";
import type { SmsProvider } from "./SmsProvider";

const SMS_IR_VERIFY_URL = "https://api.sms.ir/v1/send/verify";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Real provider: sms.ir "Verify" (template) API — high-priority service line,
 * intended for OTP. The message text lives in the sms.ir panel template, which
 * must contain a `#Code#` placeholder (parameter name "Code").
 *
 * The OTP code is never included in errors or logs.
 */
export class SmsIrProvider implements SmsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly templateId: number,
  ) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch(SMS_IR_VERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": this.apiKey },
        body: JSON.stringify({
          mobile: phone,
          templateId: this.templateId,
          parameters: [{ name: "Code", value: code }],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new AppError(502, "SMS_SEND_FAILED", "ارسال پیامک ناموفق بود. لطفاً دوباره تلاش کنید");
    }

    // sms.ir can answer HTTP 200 with a non-1 `status` on failure, so check both.
    const body = (await response.json().catch(() => null)) as { status?: number } | null;
    if (!response.ok || !body || body.status !== 1) {
      console.error(`[sms.ir] send failed: http=${response.status} status=${body?.status ?? "n/a"}`);
      throw new AppError(502, "SMS_SEND_FAILED", "ارسال پیامک ناموفق بود. لطفاً دوباره تلاش کنید");
    }
  }
}
