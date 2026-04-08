import mongoose, { Schema, Document } from "mongoose";

export type UserRole = "user" | "admin";

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  isVerified: boolean;
  twoFAEnabled: boolean;
  twoFASecret?: string;
  publicId?: string;
  referralCode: string;
  referredBy?: mongoose.Types.ObjectId;
  balance: number;
  miningDisclaimerAcceptedAt?: Date;
  loginLogs: { ip: string; at: Date; event?: "login" | "logout" }[];
  suspended: boolean;
}

const UserSchema = new Schema<IUser>(
  {
    email: { type: String, unique: true, required: true, index: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    isVerified: { type: Boolean, default: false },
    twoFAEnabled: { type: Boolean, default: false },
    twoFASecret: { type: String },
    publicId: { type: String, unique: true, sparse: true },
    referralCode: { type: String, unique: true, required: true },
    referredBy: { type: Schema.Types.ObjectId, ref: "User" },
    balance: { type: Number, default: 0 },
    miningDisclaimerAcceptedAt: { type: Date },
    loginLogs: { 
      type: [{ 
        ip: String, 
        at: Date, 
        event: { type: String, enum: ["login", "logout"], default: "login" } 
      }], 
      default: [] 
    },
    suspended: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", UserSchema);
