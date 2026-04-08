"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const env_1 = require("../config/env");
const User_1 = require("../models/User");
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
    const uri = env_1.env.MONGO_URI || env_1.env.LOCAL_MONGO_URI;
    const setPassword = args.password || process.env.ADMIN_PASSWORD || "";
    try {
        await mongoose_1.default.connect(uri, { serverSelectionTimeoutMS: 5000 });
    }
    catch (e) {
        throw new Error("Failed to connect to MongoDB. Ensure MONGO_URI/LOCAL_MONGO_URI is set and reachable.");
    }
    let user = await User_1.User.findOne({ email });
    const isCreating = !user;
    let passwordShown = "";
    if (!user) {
        const passwordToUse = setPassword || randomPassword(20);
        const passwordHash = await bcrypt_1.default.hash(passwordToUse, 12);
        const referralCode = Math.random().toString(36).slice(2, 8);
        user = await User_1.User.create({
            email,
            passwordHash,
            name,
            referralCode,
            role: "admin",
            isVerified: true,
        });
        passwordShown = passwordToUse;
    }
    else {
        const updates = { role: "admin", isVerified: true };
        if (setPassword) {
            updates.passwordHash = await bcrypt_1.default.hash(setPassword, 12);
            passwordShown = setPassword;
        }
        await User_1.User.updateOne({ _id: user._id }, { $set: updates });
        user = await User_1.User.findById(user._id);
    }
    await mongoose_1.default.disconnect();
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
    try {
        await mongoose_1.default.disconnect();
    }
    catch { }
    process.exit(1);
});
