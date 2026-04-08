import mongoose, { Document, Schema } from "mongoose";

export interface IPlatformPolicy extends Document {
  policyVersion: string;
  policyText: string;
  miningDisclaimerText: string;
  lockDurationDays: number;
  withdrawalsPaused: boolean;
  availableLiquidity: number;
}

const PlatformPolicySchema = new Schema<IPlatformPolicy>(
  {
    policyVersion: { type: String, required: true, default: "v1.0.0" },
    policyText: {
      type: String,
      required: true,
      default: "By investing, you agree that your capital will be locked for 3 months (90 days) and cannot be withdrawn during this period.",
    },
    miningDisclaimerText: {
      type: String,
      required: true,
      default: "Your invested capital is locked for 3 months (90 days) from the date of deposit. You may only withdraw your initial capital after the lock period expires.",
    },
    lockDurationDays: { type: Number, required: true, default: 90, min: 1 },
    withdrawalsPaused: { type: Boolean, default: false },
    availableLiquidity: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

export const PlatformPolicy = mongoose.model<IPlatformPolicy>("PlatformPolicy", PlatformPolicySchema);
