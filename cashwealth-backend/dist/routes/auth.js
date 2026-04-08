"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const User_1 = require("../models/User");
const env_1 = require("../config/env");
const joi_1 = __importDefault(require("joi"));
const speakeasy_1 = __importDefault(require("speakeasy"));
// Use global fetch (Node 18+)
const crypto_1 = __importDefault(require("crypto"));
const EmailToken_1 = require("../models/EmailToken");
const nodemailer_1 = __importDefault(require("nodemailer"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const auth_1 = require("../middleware/auth");
const authController_1 = require("../controllers/authController");
const router = (0, express_1.Router)();
function renderVerificationEmail(name, code) {
    const displayName = (name || "User").toString();
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Email Verification</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; background:#f6f8fb; margin:0; padding:0; }
    .container { max-width:600px; margin:40px auto; background:#ffffff; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.08); }
    .header { padding:24px; border-bottom:1px solid #eef2f7; }
    .brand { font-size:18px; font-weight:600; color:#0d1b2a; }
    .content { padding:24px; color:#1f2937; }
    .greeting { font-size:16px; margin-bottom:16px; }
    .code { font-size:32px; letter-spacing:6px; font-weight:700; color:#0ea5e9; background:#f0f9ff; padding:16px; text-align:center; border-radius:8px; }
    .note { margin-top:16px; font-size:14px; color:#6b7280; }
    .footer { padding:16px 24px; color:#9ca3af; font-size:12px; border-top:1px solid #eef2f7; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">Cashwealth</div>
    </div>
    <div class="content">
      <p class="greeting">Hi ${displayName},</p>
      <p>Use the verification code below to verify your email address:</p>
      <div class="code">${code}</div>
      <p class="note">This code will expire in 15 minutes.</p>
    </div>
    <div class="footer">
      If you didn’t request this, you can safely ignore this email.
    </div>
  </div>
</body>
</html>`;
}
function getTransporter() {
    try {
        if (env_1.env.SMTP_URL) {
            return nodemailer_1.default.createTransport(env_1.env.SMTP_URL);
        }
        if (env_1.env.SMTP_HOST && env_1.env.SMTP_USER && env_1.env.SMTP_PASS) {
            const secure = env_1.env.SMTP_PORT === 465;
            return nodemailer_1.default.createTransport({
                host: env_1.env.SMTP_HOST,
                port: env_1.env.SMTP_PORT,
                secure,
                requireTLS: !secure,
                tls: { minVersion: "TLSv1.2", rejectUnauthorized: false },
                auth: { user: env_1.env.SMTP_USER, pass: env_1.env.SMTP_PASS },
            });
        }
    }
    catch (e) {
        console.error("SMTP transport setup failed:", e?.message || e);
    }
    return null;
}
router.get("/csrf", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const tokenFn = req.csrfToken;
    const csrfToken = typeof tokenFn === "function" ? tokenFn() : "";
    res.json({ csrfToken });
});
const registerSchema = joi_1.default.object({
    email: joi_1.default.string().email().required(),
    password: joi_1.default.string().min(8).required(),
    name: joi_1.default.string().min(2).required(),
    recaptchaToken: joi_1.default.string().optional(),
    ref: joi_1.default.string()
        .allow("", null)
        .custom((v) => {
        if (!v)
            return undefined;
        const normalized = String(v)
            .normalize("NFKC")
            .replace(/[—–‐‑‒–—―]/g, "-")
            .replace(/\s+/g, "")
            .toUpperCase()
            .replace(/[^A-Z0-9-]/g, "");
        return normalized || undefined;
    }, "normalize referral code")
        .optional(),
});
router.post("/register", async (req, res) => {
    try {
        const { error, value } = registerSchema.validate(req.body);
        if (error)
            return res.status(400).json({ message: error.message });
        const dev = (process.env.NODE_ENV || "").toLowerCase() !== "production";
        const emailNormalized = String(value.email).trim().toLowerCase();
        const exists = await User_1.User.findOne({ email: emailNormalized });
        if (exists)
            return res.status(409).json({ message: "Email already registered" });
        const passwordHash = await bcrypt_1.default.hash(value.password, 12);
        // Generate unique publicId in CW###### format (numeric, no hyphen)
        let publicId = null;
        for (let i = 0; i < 20; i++) {
            const pid = "CW" + Math.floor(100000 + Math.random() * 900000).toString();
            const taken = await User_1.User.findOne({ publicId: pid });
            if (!taken) {
                publicId = pid;
                break;
            }
        }
        if (!publicId) {
            publicId = "CW" + Math.floor(100000 + Math.random() * 900000).toString();
        }
        const referralCode = publicId;
        const doc = {
            email: emailNormalized,
            passwordHash,
            name: value.name,
            publicId,
            referralCode,
            isVerified: true,
        };
        if (value.ref) {
            const refVal = String(value.ref)
                .normalize("NFKC")
                .replace(/[—–‐‑‒–—―]/g, "-")
                .replace(/\s+/g, "")
                .toUpperCase()
                .replace(/[^A-Z0-9-]/g, "");
            const referrer = await User_1.User.findOne({ referralCode: refVal });
            if (referrer) {
                doc.referredBy = referrer._id;
            }
        }
        const user = await User_1.User.create(doc);
        return res.json({
            message: "Registered.",
            userId: user.id,
        });
    }
    catch (e) {
        return res.status(500).json({ message: "Server error" });
    }
});
const verifyEmailLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
});
const loginSchema = joi_1.default.object({
    email: joi_1.default.string().email().required(),
    password: joi_1.default.string().required(),
    recaptchaToken: joi_1.default.string().optional(),
});
router.get("/csrf", (req, res) => {
    try {
        res.setHeader("Cache-Control", "no-store");
        const tokenFn = req.csrfToken;
        const csrfToken = typeof tokenFn === "function" ? tokenFn() : "";
        res.json({ csrfToken });
    }
    catch {
        res.status(500).json({ csrfToken: "" });
    }
});
router.post("/login", async (req, res) => {
    try {
        const { error, value } = loginSchema.validate(req.body);
        if (error)
            return res.status(400).json({ message: error.message });
        const email = String(value.email).trim().toLowerCase();
        await (0, authController_1.handleLogin)(req, res, email, value.password);
    }
    catch {
        return res.status(500).json({ message: "Server error" });
    }
});
const changePasswordSchema = joi_1.default.object({
    currentPassword: joi_1.default.string().required(),
    newPassword: joi_1.default.string().min(8).required(),
});
router.post("/change-password", auth_1.requireAuth, async (req, res) => {
    try {
        const { error, value } = changePasswordSchema.validate(req.body || {});
        if (error)
            return res.status(400).json({ message: error.message });
        const userId = req.userId;
        const user = await User_1.User.findById(userId);
        if (!user)
            return res.status(404).json({ message: "User not found" });
        const ok = await bcrypt_1.default.compare(value.currentPassword, user.passwordHash);
        if (!ok)
            return res.status(401).json({ message: "Invalid current password" });
        const passwordHash = await bcrypt_1.default.hash(value.newPassword, 12);
        await User_1.User.updateOne({ _id: user._id }, { $set: { passwordHash } });
        res.json({ message: "Password updated" });
    }
    catch {
        res.status(500).json({ message: "Server error" });
    }
});
router.post("/logout", async (req, res) => {
    await (0, authController_1.handleLogout)(req, res);
});
router.post("/logout-session", auth_1.requireAuth, async (req, res) => {
    await (0, authController_1.handleLogoutSession)(req, res);
});
router.post("/2fa/setup", auth_1.requireAuth, async (req, res) => {
    const userId = req.userId;
    const secret = speakeasy_1.default.generateSecret({ name: "Cashwealth" });
    await User_1.User.findByIdAndUpdate(userId, { twoFASecret: secret.base32 });
    res.json({ otpauth_url: secret.otpauth_url });
});
router.post("/2fa/verify", auth_1.requireAuth, async (req, res) => {
    const userId = req.userId;
    const user = await User_1.User.findById(userId);
    if (!user?.twoFASecret)
        return res.status(400).json({ message: "No 2FA secret" });
    const ok = speakeasy_1.default.totp.verify({
        secret: user.twoFASecret,
        encoding: "base32",
        token: req.body.token,
        window: 1,
    });
    if (!ok)
        return res.status(400).json({ message: "Invalid token" });
    user.twoFAEnabled = true;
    await user.save();
    res.json({ message: "2FA enabled" });
});
router.get("/verify", async (_req, res) => {
    return res.status(410).json({ message: "Endpoint deprecated. Use POST /auth/verify-email with email and code." });
});
const verifyCodeSchema = joi_1.default.object({
    email: joi_1.default.string().email().required(),
    code: joi_1.default.string().length(6).pattern(/^[0-9]+$/).required(),
});
router.post("/verify-code", verifyEmailLimiter, async (req, res) => {
    try {
        const { error, value } = verifyCodeSchema.validate(req.body);
        if (error)
            return res.status(400).json({ message: error.message });
        const user = await User_1.User.findOne({ email: String(value.email).trim().toLowerCase() });
        if (!user)
            return res.status(400).json({ message: "Invalid code" });
        if (user.isVerified)
            return res.status(400).json({ message: "Already verified" });
        const record = await EmailToken_1.EmailToken.findOne({ userId: user._id, type: "verify" }).sort({ expiresAt: -1 });
        if (!record)
            return res.status(400).json({ message: "Invalid code" });
        if (record.expiresAt < new Date())
            return res.status(400).json({ message: "Code expired" });
        const ok = await bcrypt_1.default.compare(String(value.code), record.codeHash);
        if (!ok)
            return res.status(400).json({ message: "Invalid code" });
        await User_1.User.updateOne({ _id: user._id }, { $set: { isVerified: true } });
        await EmailToken_1.EmailToken.deleteMany({ userId: user._id, type: "verify" });
        res.json({ message: "Email verified" });
    }
    catch {
        // Fallback: don't fail the client; behave as if code was sent
        res.json({ message: "Verification code sent" });
    }
});
router.post("/verify-email", verifyEmailLimiter, async (req, res) => {
    try {
        const { error, value } = verifyCodeSchema.validate(req.body);
        if (error)
            return res.status(400).json({ message: error.message });
        const user = await User_1.User.findOne({ email: String(value.email).trim().toLowerCase() });
        if (!user)
            return res.status(400).json({ message: "Invalid code" });
        if (user.isVerified)
            return res.status(400).json({ message: "Already verified" });
        const record = await EmailToken_1.EmailToken.findOne({ userId: user._id, type: "verify" }).sort({ expiresAt: -1 });
        if (!record)
            return res.status(400).json({ message: "Invalid code" });
        if (record.expiresAt < new Date())
            return res.status(400).json({ message: "Code expired" });
        const ok = await bcrypt_1.default.compare(String(value.code), record.codeHash);
        if (!ok)
            return res.status(400).json({ message: "Invalid code" });
        await User_1.User.updateOne({ _id: user._id }, { $set: { isVerified: true } });
        await EmailToken_1.EmailToken.deleteMany({ userId: user._id, type: "verify" });
        res.json({ message: "Email verified" });
    }
    catch {
        res.status(500).json({ message: "Server error" });
    }
});
const resendSchema = joi_1.default.object({
    email: joi_1.default.string().email().optional(),
    userId: joi_1.default.string().length(24).hex().optional(),
}).or("email", "userId");
const resendLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
});
router.post("/resend-code", resendLimiter, async (req, res) => {
    try {
        const body = req.body || {};
        const userId = typeof body.userId === "string" ? body.userId : undefined;
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
        let user = null;
        if (userId && /^[a-f0-9]{24}$/i.test(userId)) {
            user = await User_1.User.findById(userId);
        }
        if (!user && email) {
            user = await User_1.User.findOne({ email });
        }
        if (!user) {
            // Prevent user enumeration: always respond success even if account doesn't exist
            return res.json({ message: "Verification code sent" });
        }
        if (user.isVerified)
            return res.json({ message: "Already verified" });
        const code = String(crypto_1.default.randomInt(100000, 1000000));
        await EmailToken_1.EmailToken.deleteMany({ userId: user._id, type: "verify" });
        const codeHash = await bcrypt_1.default.hash(code, 12);
        await EmailToken_1.EmailToken.create({
            userId: user._id,
            codeHash,
            type: "verify",
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        });
        const transporter2 = getTransporter();
        if (transporter2) {
            try {
                await transporter2.verify().catch((e) => {
                    console.error("SMTP verify failed:", e?.message || e);
                });
                const html = renderVerificationEmail(user.name, code);
                await transporter2.sendMail({
                    from: env_1.env.SMTP_FROM ? env_1.env.SMTP_FROM : `Cashwealth <${env_1.env.SMTP_USER}>`,
                    to: user.email,
                    subject: "Your Cashwealth verification code",
                    text: `Your verification code is ${code}. It expires in 15 minutes.`,
                    html,
                });
            }
            catch (e) {
                console.error("Email send failed:", e?.message || e);
            }
        }
        const devHint = ((process.env.NODE_ENV || "").toLowerCase() !== "production");
        res.json({ message: "Verification code sent", verifyCodeDev: devHint ? code : undefined });
    }
    catch {
        res.status(500).json({ message: "Server error" });
    }
});
router.get("/dev/last-code", async (req, res) => {
    const dev = (process.env.NODE_ENV || "").toLowerCase() !== "production";
    if (!dev)
        return res.status(403).json({ message: "Not allowed" });
    try {
        const q = req.query || {};
        const userId = typeof q.userId === "string" ? q.userId : undefined;
        const email = typeof q.email === "string" ? q.email.trim().toLowerCase() : undefined;
        let user = null;
        if (userId && /^[a-f0-9]{24}$/i.test(userId)) {
            user = await User_1.User.findById(userId);
        }
        if (!user && email) {
            user = await User_1.User.findOne({ email });
        }
        if (!user)
            return res.status(404).json({ message: "User not found" });
        const record = await EmailToken_1.EmailToken.findOne({ userId: user._id, type: "verify", expiresAt: { $gt: new Date() } }).sort({ expiresAt: -1 });
        if (!record)
            return res.status(404).json({ message: "No active code" });
        res.json({ message: "Codes are hashed; use verifyCodeDev from register/resend responses in development." });
    }
    catch {
        res.status(500).json({ message: "Server error" });
    }
});
router.post("/dev/send-test", async (req, res) => {
    const dev = (process.env.NODE_ENV || "").toLowerCase() !== "production";
    if (!dev)
        return res.status(403).json({ message: "Not allowed" });
    try {
        const to = String((req.body || {}).to || "").trim().toLowerCase();
        if (!to)
            return res.status(400).json({ message: "Missing recipient" });
        const transporter = getTransporter();
        if (!transporter)
            return res.status(400).json({ message: "SMTP not configured" });
        await transporter.verify().catch((e) => {
            console.error("SMTP verify failed:", e?.message || e);
        });
        await transporter.sendMail({
            from: env_1.env.SMTP_FROM ? env_1.env.SMTP_FROM : `Cashwealth <${env_1.env.SMTP_USER}>`,
            to,
            subject: "Cashwealth test email",
            text: "SMTP configuration works. This is a test email.",
        });
        res.json({ message: "Sent" });
    }
    catch (e) {
        console.error("Email send failed:", e?.message || e);
        res.status(500).json({ message: "Failed to send" });
    }
});
router.post("/dev/resend-latest-unverified", async (req, res) => {
    const dev = (process.env.NODE_ENV || "").toLowerCase() !== "production";
    if (!dev)
        return res.status(403).json({ message: "Not allowed" });
    try {
        const user = await User_1.User.findOne({ isVerified: false }).sort({ createdAt: -1 });
        if (!user)
            return res.status(404).json({ message: "No unverified users" });
        const code = String(crypto_1.default.randomInt(100000, 1000000));
        await EmailToken_1.EmailToken.deleteMany({ userId: user._id, type: "verify" });
        const codeHash = await bcrypt_1.default.hash(code, 12);
        await EmailToken_1.EmailToken.create({
            userId: user._id,
            codeHash,
            type: "verify",
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        });
        const transporter = getTransporter();
        if (transporter) {
            try {
                await transporter.verify().catch((e) => {
                    console.error("SMTP verify failed:", e?.message || e);
                });
                const html = renderVerificationEmail(user.name, code);
                await transporter.sendMail({
                    from: env_1.env.SMTP_FROM ? env_1.env.SMTP_FROM : `Cashwealth <${env_1.env.SMTP_USER}>`,
                    to: user.email,
                    subject: "Your Cashwealth verification code",
                    text: `Your verification code is ${code}. It expires in 15 minutes.`,
                    html,
                });
            }
            catch (e) {
                console.error("Email send failed:", e?.message || e);
            }
        }
        res.json({ message: "Resent", email: user.email, verifyCodeDev: code, userId: user.id });
    }
    catch (e) {
        res.status(500).json({ message: "Server error" });
    }
});
router.get("/dev/resend-to-email", async (req, res) => {
    const dev = (process.env.NODE_ENV || "").toLowerCase() !== "production";
    if (!dev)
        return res.status(403).json({ message: "Not allowed" });
    try {
        return res.status(404).json({ message: "Not found" });
    }
    catch (e) {
        res.status(500).json({ message: "Server error" });
    }
});
router.get("/dev/force-verify", async (req, res) => {
    const dev = (process.env.NODE_ENV || "").toLowerCase() !== "production";
    if (!dev)
        return res.status(403).json({ message: "Not allowed" });
    try {
        const email = String(req.query.email || "").trim().toLowerCase();
        if (!email)
            return res.status(400).json({ message: "Missing email" });
        let user = await User_1.User.findOne({ email });
        if (!user) {
            const passwordHash = await bcrypt_1.default.hash("Dev123456!", 10);
            let publicId = null;
            for (let i = 0; i < 10; i++) {
                const pid = "CW" + Math.floor(100000 + Math.random() * 900000).toString();
                const taken = await User_1.User.findOne({ publicId: pid });
                if (!taken) {
                    publicId = pid;
                    break;
                }
            }
            if (!publicId) {
                publicId = "CW" + Math.floor(100000 + Math.random() * 900000).toString();
            }
            user = await User_1.User.create({
                email,
                passwordHash,
                name: "Dev User",
                publicId,
                referralCode: publicId,
                isVerified: false,
            });
        }
        await User_1.User.updateOne({ _id: user._id }, { $set: { isVerified: true } });
        await EmailToken_1.EmailToken.deleteMany({ userId: user._id, type: "verify" });
        res.json({ message: "Verified", userId: user.id, email: user.email });
    }
    catch {
        res.status(500).json({ message: "Server error" });
    }
});
router.all("/dev/delete-user", async (req, res) => {
    const dev = (process.env.NODE_ENV || "").toLowerCase() !== "production";
    if (!dev)
        return res.status(403).json({ message: "Not allowed" });
    try {
        const email = String((req.query.email || (req.body || {}).email) || "").trim().toLowerCase();
        if (!email)
            return res.status(400).json({ message: "Missing email" });
        const user = await User_1.User.findOne({ email });
        let deletedTokens = 0;
        if (user) {
            const tokDel = await EmailToken_1.EmailToken.deleteMany({ userId: user._id });
            deletedTokens = tokDel.deletedCount || 0;
            await User_1.User.deleteOne({ _id: user._id });
        }
        const result = { deletedUser: user ? 1 : 0, deletedTokens, deletedPending: 0, email };
        // eslint-disable-next-line no-console
        console.log("[DEV] delete-user", result);
        res.json({ message: "Deleted", ...result });
    }
    catch (e) {
        res.status(500).json({ message: "Server error" });
    }
});
exports.default = router;
