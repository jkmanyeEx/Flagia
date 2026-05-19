"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signToken = signToken;
exports.verifyToken = verifyToken;
exports.authMiddleware = authMiddleware;
exports.teacherOnly = teacherOnly;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || 'flagia_jwt_secret_2024_kr';
function signToken(payload) {
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}
function verifyToken(token) {
    return jsonwebtoken_1.default.verify(token, JWT_SECRET);
}
function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        res.status(401).json({ error: '인증이 필요합니다' });
        return;
    }
    try {
        const payload = verifyToken(header.slice(7));
        req.user = payload;
        next();
    }
    catch {
        res.status(401).json({ error: '유효하지 않은 토큰입니다' });
    }
}
function teacherOnly(req, res, next) {
    const user = req.user;
    if (user.role !== 'TEACHER') {
        res.status(403).json({ error: '교사 권한이 필요합니다' });
        return;
    }
    next();
}
//# sourceMappingURL=auth.js.map