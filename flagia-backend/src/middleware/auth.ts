import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'flagia_jwt_secret_2024_kr';

export interface AuthPayload {
  userId: string;
  role: 'TEACHER' | 'STUDENT';
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

export function teacherOnly(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).user as AuthPayload;
  if (user.role !== 'TEACHER') {
    res.status(403).json({ error: '교사 권한이 필요합니다' });
    return;
  }
  next();
}
