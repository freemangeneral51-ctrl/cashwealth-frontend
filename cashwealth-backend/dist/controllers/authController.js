"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleLogin = handleLogin;
exports.handleLogout = handleLogout;
exports.handleLogoutSession = handleLogoutSession;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const env_1 = require("../config/env");
const User_1 = require("../models/User");
const LoginActivity_1 = require("../models/LoginActivity");
function deviceFromUA(ua) {
    const s = (ua || "").toLowerCase();
    if (!s)
        return "";
    if (s.includes("iphone"))
        return "iPhone";
    if (s.includes("ipad"))
        return "iPad";
    if (s.includes("android"))
        return "Android";
    if (s.includes("windows"))
        return "Windows";
    if (s.includes("mac os") || s.includes("macintosh"))
        return "Mac";
    if (s.includes("linux"))
        return "Linux";
    return ua;
}
async function handleLogin(req, res, email, password) {
    const user = await User_1.User.findOne({ email });
    if (!user)
        return res.status(401).json({ message: "Invalid credentials" });
    const ok = await bcrypt_1.default.compare(password, user.passwordHash);
    if (!ok)
        return res.status(401).json({ message: "Invalid credentials" });
    if (user.suspended)
        return res.status(403).json({ message: "Account suspended" });
    const sessionId = crypto_1.default.randomUUID();
    const ip = req.ip || req.headers["x-forwarded-for"] || "";
    const ua = String(req.headers["user-agent"] || "");
    const device = deviceFromUA(ua);
    const now = new Date();
    if (env_1.env.SINGLE_SESSION) {
        await LoginActivity_1.LoginActivity.updateMany({ userId: user._id, status: "active" }, { $set: { status: "expired" } });
    }
    await LoginActivity_1.LoginActivity.create({
        userId: user._id,
        loginTime: now,
        ipAddress: Array.isArray(ip) ? ip[0] : String(ip),
        userAgent: ua,
        deviceInfo: device,
        sessionId,
        status: "active",
    });
    const options = { expiresIn: env_1.env.JWT_EXPIRES_IN };
    const token = jsonwebtoken_1.default.sign({ sub: user.id, role: user.role, sid: sessionId }, env_1.env.JWT_SECRET, options);
    const isProd = (process.env.NODE_ENV || "").toLowerCase() === "production" || env_1.env.FRONTEND_ORIGIN.startsWith("https");
    const allowCross = !!env_1.env.DEV_CROSS_SITE;
    res
        .cookie("token", token, { httpOnly: true, sameSite: allowCross ? "none" : "lax", secure: allowCross ? true : isProd })
        .json({
        message: "Logged in",
        role: user.role,
        userId: user.id,
        csrfToken: req.csrfToken?.(),
        token: isProd ? undefined : token,
        sessionId,
    });
}
async function handleLogout(req, res) {
    const header = req.headers.authorization;
    const token = req.cookies?.token || (header?.startsWith("Bearer ") ? header.slice(7) : undefined);
    try {
        if (token) {
            const payload = jsonwebtoken_1.default.verify(token, env_1.env.JWT_SECRET);
            const sid = payload?.sid;
            const sub = payload?.sub;
            if (sid && sub) {
                await LoginActivity_1.LoginActivity.updateOne({ userId: sub, sessionId: sid, status: "active" }, { $set: { status: "logged_out", logoutTime: new Date() } });
            }
        }
    }
    catch { }
    const isProd = (process.env.NODE_ENV || "").toLowerCase() === "production" || env_1.env.FRONTEND_ORIGIN.startsWith("https");
    const allowCross = !!env_1.env.DEV_CROSS_SITE;
    res.clearCookie("token", { httpOnly: true, sameSite: allowCross ? "none" : "lax", secure: allowCross ? true : isProd });
    res.json({ message: "Logged out" });
}
async function handleLogoutSession(req, res) {
    const userId = req.userId;
    const role = req.role;
    const body = req.body || {};
    const sid = String(body.sessionId || "");
    if (!sid)
        return res.status(400).json({ message: "Missing sessionId" });
    const filter = { sessionId: sid, status: "active" };
    if (role !== "admin")
        filter.userId = userId;
    const act = await LoginActivity_1.LoginActivity.findOne(filter);
    if (!act)
        return res.status(404).json({ message: "Session not found" });
    await LoginActivity_1.LoginActivity.updateOne({ _id: act._id }, { $set: { status: "logged_out", logoutTime: new Date() } });
    res.json({ message: "Session logged out" });
}
