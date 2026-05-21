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
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const uuid_1 = require("uuid");
const database_1 = __importDefault(require("../database"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// POST /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        if (!name || !email || !password || !role) {
            res.status(400).json({ error: '모든 필드를 입력해 주세요' });
            return;
        }
        // ADMIN is intentionally not self-registerable; admins are created by
        // promoting an existing account in the database.
        if (!['TEACHER', 'STUDENT'].includes(role)) {
            res.status(400).json({ error: '유효하지 않은 역할입니다' });
            return;
        }
        // Check duplicate
        const [existing] = await database_1.default.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            res.status(409).json({ error: '이미 등록된 이메일입니다' });
            return;
        }
        const id = (0, uuid_1.v4)();
        const passwordHash = await bcryptjs_1.default.hash(password, 12);
        await database_1.default.query('INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)', [id, name, email, passwordHash, role]);
        const token = (0, auth_1.signToken)({ userId: id, role });
        res.status(201).json({ token, user: { id, name, email, role } });
    }
    catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: '서버 오류가 발생했습니다' });
    }
});
// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            res.status(400).json({ error: '이메일과 비밀번호를 입력해 주세요' });
            return;
        }
        const [rows] = await database_1.default.query('SELECT * FROM users WHERE email = ?', [email]);
        const users = rows;
        if (users.length === 0) {
            res.status(401).json({ error: '등록되지 않은 이메일입니다' });
            return;
        }
        const user = users[0];
        const valid = await bcryptjs_1.default.compare(password, user.password_hash);
        if (!valid) {
            res.status(401).json({ error: '비밀번호가 일치하지 않습니다' });
            return;
        }
        const token = (0, auth_1.signToken)({ userId: user.id, role: user.role });
        res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    }
    catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: '서버 오류가 발생했습니다' });
    }
});
// GET /api/auth/me — validate token & return user profile
router.get('/me', async (req, res) => {
    try {
        const header = req.headers.authorization;
        if (!header || !header.startsWith('Bearer ')) {
            res.status(401).json({ error: '인증이 필요합니다' });
            return;
        }
        const { verifyToken } = await Promise.resolve().then(() => __importStar(require('../middleware/auth')));
        const payload = verifyToken(header.slice(7));
        const [rows] = await database_1.default.query('SELECT id, name, email, role FROM users WHERE id = ?', [payload.userId]);
        const users = rows;
        if (users.length === 0) {
            res.status(401).json({ error: '사용자를 찾을 수 없습니다' });
            return;
        }
        res.json({ user: users[0] });
    }
    catch (err) {
        res.status(401).json({ error: '유효하지 않은 토큰입니다' });
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map