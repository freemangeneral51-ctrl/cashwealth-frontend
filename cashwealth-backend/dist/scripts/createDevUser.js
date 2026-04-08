"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const env_1 = require("../config/env");
const User_1 = require("../models/User");
const EmailToken_1 = require("../models/EmailToken");
const crypto_1 = __importDefault(require("crypto"));
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
async function genPublicId() {
    for (let i = 0; i < 20; i++) {
        const pid = "CW" + Math.floor(100000 + Math.random() * 900000).toString();
        const taken = await User_1.User.findOne({ publicId: pid });
        if (!taken)
            return pid;
    }
    return "CW" + Math.floor(100000 + Math.random() * 900000).toString();
}
async function main() {
    const args = parseArgs(process.argv);
    const emailRaw = args.email || "";
    const name = args.name || emailRaw.split("@")[0] || "User";
    const password = args.password || "Test12345!";
    if (!emailRaw) {
        console.error("Usage: node dist/scripts/createDevUser.js --email you@example.com [--name 'Your Name'] [--password 'Secret']");
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
        let user = await User_1.User.findOne({ email });
        if (!user) {
            const publicId = await genPublicId();
            const referralCode = publicId;
            const passwordHash = await bcrypt_1.default.hash(password, 12);
            user = await User_1.User.create({
                email,
                name,
                passwordHash,
                publicId,
                referralCode,
                isVerified: false,
            });
        }
        else {
            user.isVerified = false;
            await user.save();
        }
        const code = String(crypto_1.default.randomInt(100000, 1000000));
        await EmailToken_1.EmailToken.deleteMany({ userId: user._id, type: "verify" });
        const codeHash = await bcrypt_1.default.hash(code, 12);
        const record = await EmailToken_1.EmailToken.create({
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
    }
    finally {
        await mongoose_1.default.disconnect();
    }
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
