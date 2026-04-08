import express from "express";
import mongoose from "mongoose";
import { env } from "./config/env";
import { applySecurity } from "./middleware/security";
import authRoutes from "./routes/auth";
import depositRoutes from "./routes/deposits";
import withdrawalRoutes from "./routes/withdrawals";
import adminRoutes from "./routes/admin";
import userRoutes from "./routes/user";
import { requireAuth } from "./middleware/auth";
import bcrypt from "bcrypt";
import { User } from "./models/User";
import miningRoutes from "./routes/mining";
import { MiningSession } from "./models/MiningSession";
import { Transaction } from "./models/Transaction";

async function main() {
  const uri = env.MONGO_URI || env.LOCAL_MONGO_URI;
  let connected = false;
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 } as any);
    connected = true;
  } catch (e) {
    const dev = (process.env.NODE_ENV || "").toLowerCase() !== "production";
    if (dev) {
      try {
        const { MongoMemoryServer } = await import("mongodb-memory-server");
        const mem = await MongoMemoryServer.create();
        await mongoose.connect(mem.getUri());
        connected = true;
        console.log("Using in-memory MongoDB for development");
      } catch {
      }
    } else {
      throw e;
    }
  }
  const app = express();
  applySecurity(app);

  async function normalizeExistingReferralCodes() {
    const users = await User.find({}, { _id: 1, publicId: 1, referralCode: 1 }).lean();
    const taken = new Set<string>();
    for (const u of users) {
      const raw = (u.referralCode || u.publicId || "").toString().toUpperCase();
      const norm = raw.normalize("NFKC").replace(/[—–‐‑‒–—―]/g, "-").replace(/\s+/g, "").replace(/-/g, "");
      if (norm) taken.add(norm);
    }
    function gen(): string {
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
        while (taken.has(c)) c = gen();
        target = c;
      }
      const curNoHyphen = current.replace(/-/g, "");
      if (curNoHyphen !== target) {
        taken.add(target);
        await User.updateOne(
          { _id: u._id },
          { $set: { publicId: target, referralCode: target } }
        );
        updates++;
      } else if (!u.publicId || !u.referralCode || u.publicId !== target || u.referralCode !== target) {
        // Ensure both fields are populated and equal
        await User.updateOne(
          { _id: u._id },
          { $set: { publicId: target, referralCode: target } }
        );
      }
    }
    if (updates > 0) {
      console.log(`Normalized referral/public IDs for ${updates} user(s)`);
    }
  }

  async function ensureDefaultAdmin() {
    const email = env.ADMIN_EMAIL;
    const password = env.ADMIN_PASSWORD;
    const name = env.ADMIN_NAME || "Administrator";
    if (!email || !password) return;
    let user = await User.findOne({ email });
    const passwordHash = await bcrypt.hash(password, 12);
    if (!user) {
      const publicId = ("CW" + Math.floor(100000 + Math.random() * 900000).toString()).toUpperCase();
      const referralCode = publicId;
      await User.create({
        email,
        passwordHash,
        name,
        publicId,
        referralCode,
        role: "admin",
        isVerified: true,
      } as any);
      console.log(`Default admin ensured for ${email}`);
    } else {
      const updates: any = { role: "admin", isVerified: true };
      if (password) updates.passwordHash = passwordHash;
      if (!user.publicId) {
        updates.publicId = ("CW" + Math.floor(100000 + Math.random() * 900000).toString()).toUpperCase();
        updates.referralCode = updates.publicId;
      }
      await User.updateOne({ _id: user._id }, { $set: updates });
      console.log(`Default admin updated for ${email}`);
    }
  }
  if (connected) {
    await ensureDefaultAdmin();
    await normalizeExistingReferralCodes();
  }

  app.get("/", (_req, res) => res.json({ ok: true, service: "cashwealth-api" }));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/auth", authRoutes);
  app.use("/user", requireAuth, userRoutes);
  app.use("/deposits", requireAuth, depositRoutes);
  app.use("/withdrawals", requireAuth, withdrawalRoutes);
  app.use("/admin", requireAuth, adminRoutes);
  app.use("/mining", requireAuth, miningRoutes);

  app.listen(Number(env.PORT), "0.0.0.0", () => {
    console.log(`API on http://localhost:${env.PORT} (bound 0.0.0.0)`);
  });

  // Mining expiry scheduler: finalize sessions that have reached 24h
  setInterval(async () => {
    try {
      const now = new Date();
      const sessions = await MiningSession.find({ status: "active", expiresAt: { $lte: now } }).limit(50);
      for (const s of sessions) {
        s.status = "expired";
        await s.save();
        if (!s.credited) {
          await User.updateOne({ _id: s.userId }, { $inc: { balance: s.earnedAmount } });
          await Transaction.create({
            userId: s.userId,
            type: "interest",
            amount: s.earnedAmount,
            meta: { mining: true, sessionId: s._id, rate: s.rate, activatedAt: s.activatedAt, expiresAt: s.expiresAt },
          });
          await MiningSession.updateOne({ _id: s._id }, { $set: { credited: true } });
        }
      }
    } catch {}
  }, 60_000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
