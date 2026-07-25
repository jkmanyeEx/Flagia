import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

function getJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return 'flagia_development_only_secret';
}

const JWT_SECRET = getJwtSecret();

export interface AuthPayload {
  userId: string;
  role: 'TEACHER' | 'STUDENT' | 'ADMIN';
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, JWT_SECRET) as AuthPayload;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: '인증이 필요합니다' });
    return;
  }
  try {
    const payload = verifyToken(header.slice(7));
    (req as any).user = payload;
    next();
  } catch {
    res.status(401).json({ error: '유효하지 않은 토큰입니다' });
  }
}

// Allows TEACHER and ADMIN through. Admins may author/manage their own
// resources just like a teacher; per-endpoint ownership checks (teacher_id ===
// userId) still restrict mutations to resources the caller actually owns, so an
// admin can never modify another teacher's classroom/assignment.
export function teacherOnly(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).user as AuthPayload;
  if (user.role !== 'TEACHER' && user.role !== 'ADMIN') {
    res.status(403).json({ error: '교사 권한이 필요합니다' });
    return;
  }
  next();
}
