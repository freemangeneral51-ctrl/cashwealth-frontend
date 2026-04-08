"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const mongoose_1 = __importDefault(require("mongoose"));
const env_1 = require("./config/env");
const security_1 = require("./middleware/security");
const auth_1 = __importDefault(require("./routes/auth"));
const deposits_1 = __importDefault(require("./routes/deposits"));
const withdrawals_1 = __importDefault(require("./routes/withdrawals"));
const admin_1 = __importDefault(require("./routes/admin"));
const user_1 = __importDefault(require("./routes/user"));
const auth_2 = require("./middleware/auth");
const bcrypt_1 = __importDefault(require("bcrypt"));
const User_1 = require("./models/User");
const mining_1 = __importDefault(require("./routes/mining"));
const MiningSession_1 = require("./models/MiningSession");
const Transaction_1 = require("./models/Transaction");
async function main() {
    const uri = env_1.env.MONGO_URI || env_1.env.LOCAL_MONGO_URI;
    let connected = false;
    try {
        await mongoose_1.default.connect(uri, { serverSelectionTimeoutMS: 5000 });
        connected = true;
    }
    catch (e) {
        const dev = (process.env.NODE_ENV || "").toLowerCase() !== "production";
        if (dev) {
            try {
                const { MongoMemoryServer } = await Promise.resolve().then(() => __importStar(require("mongodb-memory-server")));
                const mem = await MongoMemoryServer.create();
                await mongoose_1.default.connect(mem.getUri());
                connected = true;
                console.log("Using in-memory MongoDB for development");
            }
            catch {
            }
        }
        else {
            throw e;
        }
    }
    const app = (0, express_1.default)();
    (0, security_1.applySecurity)(app);
    async function normalizeExistingReferralCodes() {
        const users = await User_1.User.find({}, { _id: 1, publicId: 1, referralCode: 1 }).lean();
        const taken = new Set();
        for (const u of users) {
            const raw = (u.referralCode || u.publicId || "").toString().toUpperCase();
            const norm = raw.normalize("NFKC").replace(/[—–‐‑‒–—―]/g, "-").replace(/\s+/g, "").replace(/-/g, "");
            if (norm)
                taken.add(norm);
        }
        function gen() {
            return ("CW" + Math.floor(100000 + Math.random() * 900000).toString()).toUpperCase();
        }
        let updates = 0;
        for (const u of users) {
            const current = ((u.referralCode || u.publicId) || "").toString().toUpperCase();
            let target = current.normalize("NFKC").replace(/[—–‐‑‒–—―]/g, "-").replace(/\s+/g, "").replace(/-/g, "");
            if (!/^CW[0-9]{6,}$/.test(target)) {
                target = gen();
            }
            if (!target || taken.has(target) && current.replace(/-/g, "") !== target) {
                let c = gen();
                while (taken.has(c))
                    c = gen();
                target = c;
            }
            const curNoHyphen = current.replace(/-/g, "");
            if (curNoHyphen !== target) {
                taken.add(target);
                await User_1.User.updateOne({ _id: u._id }, { $set: { publicId: target, referralCode: target } });
                updates++;
            }
            else if (!u.publicId || !u.referralCode || u.publicId !== target || u.referralCode !== target) {
                // Ensure both fields are populated and equal
                await User_1.User.updateOne({ _id: u._id }, { $set: { publicId: target, referralCode: target } });
            }
        }
        if (updates > 0) {
            console.log(`Normalized referral/public IDs for ${updates} user(s)`);
        }
    }
    async function ensureDefaultAdmin() {
        const email = env_1.env.ADMIN_EMAIL;
        const password = env_1.env.ADMIN_PASSWORD;
        const name = env_1.env.ADMIN_NAME || "Administrator";
        if (!email || !password)
            return;
        let user = await User_1.User.findOne({ email });
        const passwordHash = await bcrypt_1.default.hash(password, 12);
        if (!user) {
            const publicId = ("CW" + Math.floor(100000 + Math.random() * 900000).toString()).toUpperCase();
            const referralCode = publicId;
            await User_1.User.create({
                email,
                passwordHash,
                name,
                publicId,
                referralCode,
                role: "admin",
                isVerified: true,
            });
            console.log(`Default admin ensured for ${email}`);
        }
        else {
            const updates = { role: "admin", isVerified: true };
            if (password)
                updates.passwordHash = passwordHash;
            if (!user.publicId) {
                updates.publicId = ("CW" + Math.floor(100000 + Math.random() * 900000).toString()).toUpperCase();
                updates.referralCode = updates.publicId;
            }
            await User_1.User.updateOne({ _id: user._id }, { $set: updates });
            console.log(`Default admin updated for ${email}`);
        }
    }
    if (connected) {
        await ensureDefaultAdmin();
        await normalizeExistingReferralCodes();
    }
    app.get("/", (_req, res) => res.json({ ok: true, service: "cashwealth-api" }));
    app.get("/health", (_req, res) => res.json({ ok: true }));
    app.use("/auth", auth_1.default);
    app.use("/user", auth_2.requireAuth, user_1.default);
    app.use("/deposits", auth_2.requireAuth, deposits_1.default);
    app.use("/withdrawals", auth_2.requireAuth, withdrawals_1.default);
    app.use("/admin", auth_2.requireAuth, admin_1.default);
    app.use("/mining", auth_2.requireAuth, mining_1.default);
    app.listen(Number(env_1.env.PORT), "0.0.0.0", () => {
        console.log(`API on http://localhost:${env_1.env.PORT} (bound 0.0.0.0)`);
    });
    // Mining expiry scheduler: finalize sessions that have reached 24h
    setInterval(async () => {
        try {
            const now = new Date();
            const sessions = await MiningSession_1.MiningSession.find({ status: "active", expiresAt: { $lte: now } }).limit(50);
            for (const s of sessions) {
                s.status = "expired";
                await s.save();
                if (!s.credited) {
                    await User_1.User.updateOne({ _id: s.userId }, { $inc: { balance: s.earnedAmount } });
                    await Transaction_1.Transaction.create({
                        userId: s.userId,
                        type: "interest",
                        amount: s.earnedAmount,
                        meta: { mining: true, sessionId: s._id, rate: s.rate, activatedAt: s.activatedAt, expiresAt: s.expiresAt },
                    });
                    await MiningSession_1.MiningSession.updateOne({ _id: s._id }, { $set: { credited: true } });
                }
            }
        }
        catch { }
    }, 60000);
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
