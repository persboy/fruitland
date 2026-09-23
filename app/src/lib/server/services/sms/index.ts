import { getEnv } from "../../env";
import type { SmsProvider } from "./SmsProvider";
import { ConsoleSmsProvider } from "./ConsoleSmsProvider";
import { SmsIrProvider } from "./SmsIrProvider";

let cached: SmsProvider | undefined;

export function getSmsProvider(): SmsProvider {
  if (cached) return cached;
  const { SMS_PROVIDER, SMS_IR_API_KEY, SMS_IR_TEMPLATE_ID } = getEnv();
  switch (SMS_PROVIDER) {
    case "console":
      cached = new ConsoleSmsProvider();
      return cached;
    case "smsir":
      // env.ts guarantees both values exist when SMS_PROVIDER=smsir.
      cached = new SmsIrProvider(SMS_IR_API_KEY as string, SMS_IR_TEMPLATE_ID as number);
      return cached;
    default:
      throw new Error(`Unknown SMS_PROVIDER: ${SMS_PROVIDER satisfies never}`);
  }
}
