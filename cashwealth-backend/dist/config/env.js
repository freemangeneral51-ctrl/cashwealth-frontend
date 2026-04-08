"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config({ path: ".env.local" });
dotenv_1.default.config();
exports.env = {
    PORT: process.env.PORT || "4000",
    MONGO_URI: process.env.MONGO_URI || "",
    LOCAL_MONGO_URI: process.env.LOCAL_MONGO_URI || "mongodb://127.0.0.1:27017/cashwealth",
    JWT_SECRET: process.env.JWT_SECRET || "",
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",
    FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || "http://localhost:3000",
    REDIS_URL: process.env.REDIS_URL || "",
    SMTP_HOST: process.env.SMTP_HOST || "",
    SMTP_PORT: Number(process.env.SMTP_PORT || "587"),
    SMTP_USER: process.env.SMTP_USER || "",
    SMTP_PASS: process.env.SMTP_PASS || "",
    SMTP_URL: process.env.SMTP_URL || "",
    SMTP_FROM: process.env.SMTP_FROM || "",
    SMTP_REQUIRE_TLS: String(process.env.SMTP_REQUIRE_TLS || "").toLowerCase() === "true",
    ALLOW_UNVERIFIED_DEV: String(process.env.ALLOW_UNVERIFIED_DEV || "").toLowerCase() === "true",
    DEV_PURGE_ON_REGISTER: String(process.env.DEV_PURGE_ON_REGISTER || "true").toLowerCase() === "true",
    PLATFORM_USDT_ADDRESS: process.env.PLATFORM_USDT_ADDRESS || "",
    PLATFORM_TRX_ADDRESS: process.env.PLATFORM_TRX_ADDRESS || "",
    ADMIN_EMAIL: process.env.ADMIN_EMAIL || "",
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "",
    ADMIN_NAME: process.env.ADMIN_NAME || "Administrator",
    DEV_CROSS_SITE: String(process.env.DEV_CROSS_SITE || "").toLowerCase() === "true",
    SINGLE_SESSION: String(process.env.SINGLE_SESSION || "").toLowerCase() === "true",
};
