import mongoose, { Schema, Document } from "mongoose";

export type AssetType = "USDT_TRC20" | "TRON_TRX";
export type DepositStatus = "pending" | "approved" | "rejected";
export type CapitalWithdrawalStatus = "locked" | "eligible" | "withdrawn";
export type WithdrawalQueueStatus = "none" | "pending" | "processing" | "completed";

export interface IDeposit extends Document {
  userId: mongoose.Types.ObjectId;
  asset: AssetType;
  txHash: string;
  amount: number;
  status: DepositStatus;
  reviewedBy?: mongoose.Types.ObjectId;
  txAt?: Date;
  capitalUnlockAt?: Date;
  capitalWithdrawalStatus: CapitalWithdrawalStatus;
  withdrawalQueueStatus: WithdrawalQueueStatus;
  lockDurationDays?: number;
  policyVersionAccepted?: string;
  agreementAcceptedAt?: Date;
  agreementAcceptedIp?: string;
  capitalWithdrawnAt?: Date;
}

const DepositSchema = new Schema<IDeposit>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    asset: { type: String, enum: ["USDT_TRC20", "TRON_TRX"], required: true },
    txHash: { type: String, required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    txAt: { type: Date },
    capitalUnlockAt: { type: Date, index: true },
    capitalWithdrawalStatus: { type: String, enum: ["locked", "eligible", "withdrawn"], default: "locked", index: true },
    withdrawalQueueStatus: { type: String, enum: ["none", "pending", "processing", "completed"], default: "none" },
    lockDurationDays: { type: Number },
    policyVersionAccepted: { type: String },
    agreementAcceptedAt: { type: Date },
    agreementAcceptedIp: { type: String },
    capitalWithdrawnAt: { type: Date },
  },
  { timestamps: true }
);

export const Deposit = mongoose.model<IDeposit>("Deposit", DepositSchema);
