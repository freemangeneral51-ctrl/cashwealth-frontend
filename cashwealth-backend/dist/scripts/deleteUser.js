"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const env_1 = require("../config/env");
const User_1 = require("../models/User");
const EmailToken_1 = require("../models/EmailToken");
const Transaction_1 = require("../models/Transaction");
const Deposit_1 = require("../models/Deposit");
const Withdrawal_1 = require("../models/Withdrawal");
const Notification_1 = require("../models/Notification");
function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const part = argv[i];
        if (part.startsWith("--")) {
            const [k, v] = part.slice(2).split("=", 2);
            if (v !== undefined) {
                args[k] = v;
            }
            else {
                const nxt = argv[i + 1];
                if (nxt && !nxt.startsWith("--")) {
                    args[k] = nxt;
                    i++;
                }
                else {
                    args[k] = true;
                }
            }
        }
    }
    return args;
}
async function main() {
    const args = parseArgs(process.argv);
    const emailRaw = args.email || "";
    if (!emailRaw) {
        console.error("Usage: node dist/scripts/deleteUser.js --email you@example.com");
        process.exit(1);
    }
    const email = emailRaw.trim().toLowerCase();
    const uri = env_1.env.MONGO_URI || env_1.env.LOCAL_MONGO_URI;
    if (!uri) {
        console.error("No Mongo URI configured");
        process.exit(1);
    }
    await mongoose_1.default.connect(uri);
    try {
        const user = await User_1.User.findOne({ email });
        if (!user) {
            console.log(`No user found for email: ${email}`);
            return;
        }
        const userId = user._id;
        const delTokens = await EmailToken_1.EmailToken.deleteMany({ userId });
        const delTxs = await Transaction_1.Transaction.deleteMany({ userId });
        const delDeps = await Deposit_1.Deposit.deleteMany({ userId });
        const delWds = await Withdrawal_1.Withdrawal.deleteMany({ userId });
        const delNotifs = await Notification_1.Notification.deleteMany({ userId });
        await User_1.User.deleteOne({ _id: userId });
        console.log(`Deleted user ${email} and related data:`);
        console.log(` - EmailTokens: ${delTokens.deletedCount}`);
        console.log(` - Transactions: ${delTxs.deletedCount}`);
        console.log(` - Deposits: ${delDeps.deletedCount}`);
        console.log(` - Withdrawals: ${delWds.deletedCount}`);
        console.log(` - Notifications: ${delNotifs.deletedCount}`);
    }
    finally {
        await mongoose_1.default.disconnect();
    }
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
