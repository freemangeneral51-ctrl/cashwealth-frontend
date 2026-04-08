"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applySecurity = applySecurity;
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const morgan_1 = __importDefault(require("morgan"));
const csurf_1 = __importDefault(require("csurf"));
const env_1 = require("../config/env");
const express_1 = __importDefault(require("express"));
function applySecurity(app) {
    app.use((0, helmet_1.default)({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
    const isDev = (process.env.NODE_ENV || "").toLowerCase() !== "production";
    const allowCrossSite = !!env_1.env.DEV_CROSS_SITE;
    const origins = env_1.env.FRONTEND_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean);
    const corsOptions = {
        origin: isDev
            ? (_origin, cb) => cb(null, true)
            : origins.length > 0
                ? origins
                : env_1.env.FRONTEND_ORIGIN,
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
    };
    app.use((0, cors_1.default)(corsOptions));
    app.use((0, cookie_parser_1.default)());
    app.use(express_1.default.json());
    app.use((0, morgan_1.default)("combined"));
    const limiter = (0, express_rate_limit_1.default)({
        windowMs: 15 * 60 * 1000,
        max: isDev ? 2000 : 100,
        standardHeaders: true,
        legacyHeaders: false,
    });
    app.use(limiter);
    const csrfProtection = (0, csurf_1.default)({
        cookie: allowCrossSite ? { sameSite: "none", secure: true } : { sameSite: "lax", secure: !isDev },
    });
    app.use((req, res, next) => {
        if (allowCrossSite)
            return next();
        if (req.path === "/auth/csrf")
            return csrfProtection(req, res, next);
        const openAuth = /^\/auth\/(register|verify|verify-code|verify-email|resend-code|dev\/last-code|dev\/send-test)$/.test(req.path);
        if (openAuth)
            return next();
        return csrfProtection(req, res, next);
    });
}
