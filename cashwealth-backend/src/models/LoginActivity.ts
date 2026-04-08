import mongoose, { Schema, Document } from "mongoose";

export type LoginStatus = "active" | "logged_out" | "expired";

export interface ILoginActivity extends Document {
  userId: mongoose.Types.ObjectId;
  loginTime: Date;
  logoutTime?: Date;
  ipAddress?: string;
  userAgent?: string;
  deviceInfo?: string;
  location?: string;
  sessionId: string;
  status: LoginStatus;
}

const LoginActivitySchema = new Schema<ILoginActivity>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    loginTime: { type: Date, required: true },
    logoutTime: { type: Date },
    ipAddress: { type: String },
    userAgent: { type: String },
    deviceInfo: { type: String },
    location: { type: String },
    sessionId: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ["active", "logged_out", "expired"], required: true, index: true },
  },
  { timestamps: true }
);

export const LoginActivity = mongoose.model<ILoginActivity>("LoginActivity", LoginActivitySchema);
