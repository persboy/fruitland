import type { SmsProvider } from "./SmsProvider";

/**
 * DEV/TEST ONLY. getEnv() refuses to start with SMS_PROVIDER=console when
 * NODE_ENV=production (see env.ts), so this can never run in a real
 * deployment. Logging an OTP code is only acceptable because there is no
 * production path that reaches this code.
 */
export class ConsoleSmsProvider implements SmsProvider {
  async sendOtp(phone: string, code: string): Promise<void> {
    console.log(`[dev-only SMS] OTP for ${phone}: ${code}`);
  }
}
