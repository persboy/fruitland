/**
 * Business logic (otpService) must depend on this interface only, never on
 * a concrete provider's API — see MASTER-PROMPT.md §19 ("External Services
 * must be hidden behind adapters"). Swapping in a real provider (sms.ir,
 * Kavenegar, ...) later means implementing this interface, no changes to
 * otpService.
 */
export interface SmsProvider {
  sendOtp(phone: string, code: string): Promise<void>;
}
