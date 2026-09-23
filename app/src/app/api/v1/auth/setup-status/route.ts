import { apiErrorFromException, apiSuccess } from "@/lib/server/apiResponse";
import { connectToDatabase } from "@/lib/server/db";
import { isInitialSetupRequired } from "@/lib/server/services/authService";

/** Auth: none. Success: { setupRequired } — true only until the first MASTER_ADMIN has been claimed. */
export async function GET() {
  try {
    await connectToDatabase();
    return apiSuccess({ setupRequired: await isInitialSetupRequired() });
  } catch (err) {
    return apiErrorFromException(err);
  }
}
