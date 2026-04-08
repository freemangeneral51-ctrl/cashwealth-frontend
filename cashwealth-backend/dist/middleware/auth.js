"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
const LoginActivity_1 = require("../models/LoginActivity");
function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    const token = req.cookies?.token || (header?.startsWith("Bearer ") ? header.slice(7) : undefined);
    if (!token)
        return res.status(401).json({ message: "Unauthorized" });
    try {
        const payload = jsonwebtoken_1.default.verify(token, env_1.env.JWT_SECRET);
        req.userId = payload.sub;
        req.role = payload.role;
        req.sessionId = payload.sid;
        if (!req.sessionId)
            return res.status(401).json({ message: "Unauthorized" });
        LoginActivity_1.LoginActivity.findOne({ userId: req.userId, sessionId: req.sessionId }).then((act) => {
            if (!act || act.status !== "active")
                return res.status(401).json({ message: "Unauthorized" });
            try {
                const options = { expiresIn: env_1.env.JWT_EXPIRES_IN };
                const refreshed = jsonwebtoken_1.default.sign({ sub: payload.sub, role: payload.role, sid: req.sessionId }, env_1.env.JWT_SECRET, options);
                const isProd = (process.env.NODE_ENV || "").toLowerCase() === "production" || env_1.env.FRONTEND_ORIGIN.startsWith("https");
                const allowCross = !!env_1.env.DEV_CROSS_SITE;
                res.cookie("token", refreshed, { httpOnly: true, sameSite: allowCross ? "none" : "lax", secure: allowCross ? true : isProd });
            }
            catch { }
            next();
        }).catch(() => res.status(401).json({ message: "Unauthorized" }));
    }
    catch (e) {
        try {
            const decoded = jsonwebtoken_1.default.decode(token);
            const sid = decoded?.sid;
            const sub = decoded?.sub;
            if (sid && sub) {
                LoginActivity_1.LoginActivity.updateOne({ userId: sub, sessionId: sid, status: "active" }, { $set: { status: "expired" } }).catch(() => { });
            }
        }
        catch { }
        return res.status(401).json({ message: "Unauthorized" });
    }
}
