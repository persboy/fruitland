import { z } from "zod";

export const requestEmergencyCancelSchema = z.object({
  reason: z.string().trim().min(1, "دلیل درخواست الزامی است").max(500, "دلیل درخواست حداکثر ۵۰۰ نویسه باشد"),
});

export const reviewEmergencyCancelSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    rejectionReason: z.string().trim().max(500, "دلیل رد حداکثر ۵۰۰ نویسه باشد").optional(),
  })
  .refine((v) => v.decision !== "reject" || !!v.rejectionReason?.length, {
    message: "دلیل رد الزامی است",
    path: ["rejectionReason"],
  });

export const recordPhysicalReturnSchema = z.object({
  returned: z.boolean(),
});

export type RequestEmergencyCancelInput = z.infer<typeof requestEmergencyCancelSchema>;
export type ReviewEmergencyCancelInput = z.infer<typeof reviewEmergencyCancelSchema>;
export type RecordPhysicalReturnInput = z.infer<typeof recordPhysicalReturnSchema>;
