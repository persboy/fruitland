import { getEnv } from "../../env";
import type { SmsProvider } from "./SmsProvider";
import { ConsoleSmsProvider } from "./ConsoleSmsProvider";

let cached: SmsProvider | undefined;

export function getSmsProvider(): SmsProvider {
  if (cached) return cached;
  const { SMS_PROVIDER } = getEnv();
  // Only "console" exists today (see env.ts) — add real providers here as
  // additional `case`s once one is chosen; otpService never needs to change.
  switch (SMS_PROVIDER) {
    case "console":
      cached = new ConsoleSmsProvider();
      return cached;
    default:
      throw new Error(`Unknown SMS_PROVIDER: ${SMS_PROVIDER satisfies never}`);
  }
}
