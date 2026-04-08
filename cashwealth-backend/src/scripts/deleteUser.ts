import mongoose from "mongoose";
import { env } from "../config/env";
import { User } from "../models/User";
import { EmailToken } from "../models/EmailToken";
import { Transaction } from "../models/Transaction";
import { Deposit } from "../models/Deposit";
import { Withdrawal } from "../models/Withdrawal";
import { Notification } from "../models/Notification";

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

async function main() {
  const args = parseArgs(process.argv);
  const emailRaw = (args.email as string) || "";
  if (!emailRaw) {
    console.error("Usage: node dist/scripts/deleteUser.js --email you@example.com");
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
    const user = await User.findOne({ email });
    if (!user) {
      console.log(`No user found for email: ${email}`);
      return;
    }
    const userId = user._id;
    const delTokens = await EmailToken.deleteMany({ userId });
    const delTxs = await Transaction.deleteMany({ userId });
    const delDeps = await Deposit.deleteMany({ userId });
    const delWds = await Withdrawal.deleteMany({ userId });
    const delNotifs = await Notification.deleteMany({ userId });
    await User.deleteOne({ _id: userId });
    console.log(`Deleted user ${email} and related data:`);
    console.log(` - EmailTokens: ${delTokens.deletedCount}`);
    console.log(` - Transactions: ${delTxs.deletedCount}`);
    console.log(` - Deposits: ${delDeps.deletedCount}`);
    console.log(` - Withdrawals: ${delWds.deletedCount}`);
    console.log(` - Notifications: ${delNotifs.deletedCount}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

