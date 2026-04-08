import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { env } from "../config/env";
import { User } from "../models/User";
import { EmailToken } from "../models/EmailToken";
import crypto from "crypto";

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

async function genPublicId(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const pid = "CW" + Math.floor(100000 + Math.random() * 900000).toString();
    const taken = await User.findOne({ publicId: pid });
    if (!taken) return pid;
  }
  return "CW" + Math.floor(100000 + Math.random() * 900000).toString();
}

async function main() {
  const args = parseArgs(process.argv);
  const emailRaw = (args.email as string) || "";
  const name = (args.name as string) || emailRaw.split("@")[0] || "User";
  const password = (args.password as string) || "Test12345!";
  if (!emailRaw) {
    console.error("Usage: node dist/scripts/createDevUser.js --email you@example.com [--name 'Your Name'] [--password 'Secret']");
    process.exit(1);
  }
  const email = emailRaw.trim().toLowerCase();

  const uri = env.MONGO_URI || env.LOCAL_MONGO_URI;
  if (!uri) {
    console.error("No Mongo URI configured");
    process.exit(1);
  }
  await mongoose.connect(uri);
  try {
    let user = await User.findOne({ email });
    if (!user) {
      const publicId = await genPublicId();
      const referralCode = publicId;
      const passwordHash = await bcrypt.hash(password, 12);
      user = await User.create({
        email,
        name,
        passwordHash,
        publicId,
        referralCode,
        isVerified: false,
      });
    } else {
      user.isVerified = false;
      await user.save();
    }
    const code = String(crypto.randomInt(100000, 1000000));
    await EmailToken.deleteMany({ userId: user._id, type: "verify" });
    const codeHash = await bcrypt.hash(code, 12);
    const record = await EmailToken.create({
      userId: user._id,
      codeHash,
      type: "verify",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    console.log(JSON.stringify({
      email,
      userId: String(user._id),
      code,
      expiresAt: record.expiresAt,
    }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
