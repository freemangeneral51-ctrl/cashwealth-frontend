import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { env } from "../config/env";
import { User } from "../models/User";

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const part = argv[i];
    if (part.startsWith("--")) {
      const [k, v] = part.slice(2).split("=", 2);
      if (v !== undefined) {
        args[k] = v;
      } else {
        const nxt = argv[i + 1];
        if (nxt && !nxt.startsWith("--")) {
          args[k] = nxt;
          i++;
        } else {
          args[k] = true;
        }
      }
    }
  }
  return args;
}

function randomPassword(length = 16) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()_+-=";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const email = String(args.email || process.env.ADMIN_EMAIL || "admin@cashwealth.local");
  const name = String(args.name || process.env.ADMIN_NAME || "Administrator");
  const uri = env.MONGO_URI || env.LOCAL_MONGO_URI;
  const setPassword = (args.password as string | undefined) || process.env.ADMIN_PASSWORD || "";

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 } as any);
  } catch (e) {
    throw new Error("Failed to connect to MongoDB. Ensure MONGO_URI/LOCAL_MONGO_URI is set and reachable.");
  }

  let user = await User.findOne({ email });
  const isCreating = !user;
  let passwordShown = "";

  if (!user) {
    const passwordToUse = setPassword || randomPassword(20);
    const passwordHash = await bcrypt.hash(passwordToUse, 12);
    const referralCode = Math.random().toString(36).slice(2, 8);
    user = await User.create({
      email,
      passwordHash,
      name,
      referralCode,
      role: "admin",
      isVerified: true,
    } as any);
    passwordShown = passwordToUse;
  } else {
    const updates: any = { role: "admin", isVerified: true };
    if (setPassword) {
      updates.passwordHash = await bcrypt.hash(setPassword, 12);
      passwordShown = setPassword;
    }
    await User.updateOne({ _id: user._id }, { $set: updates });
    user = await User.findById(user._id);
  }

  await mongoose.disconnect();

  console.log(JSON.stringify({
    action: isCreating ? "created_admin" : "updated_to_admin",
    email,
    name: user?.name,
    userId: user?._id?.toString(),
    password: passwordShown || "(unchanged)",
  }, null, 2));
}

main().catch(async (err) => {
  console.error(err.message || err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});

