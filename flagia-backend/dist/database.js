"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promise_1 = __importDefault(require("mysql2/promise"));
const pool = promise_1.default.createPool({
    host: '127.0.0.1',
    user: process.env.SQL_USER || 'devmeko',
    password: process.env.SQL_PW || 'Qqqq1111!',
    database: 'flagia',
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: '+09:00',
});
exports.default = pool;
//# sourceMappingURL=database.js.map