"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promise_1 = __importDefault(require("mysql2/promise"));
const isProduction = process.env.NODE_ENV === 'production';
function envValue(primary, legacy, developmentDefault) {
    const value = process.env[primary] || (legacy ? process.env[legacy] : undefined);
    if (value)
        return value;
    if (isProduction) {
        throw new Error(`${primary} must be set in production`);
    }
    return developmentDefault;
}
const pool = promise_1.default.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: envValue('DB_USER', 'SQL_USER', 'devmeko'),
    password: envValue('DB_PASSWORD', 'SQL_PW', ''),
    database: process.env.DB_NAME || 'flagia',
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: '+09:00',
});
exports.default = pool;
//# sourceMappingURL=database.js.map