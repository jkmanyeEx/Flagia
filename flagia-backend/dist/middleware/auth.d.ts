import { Request, Response, NextFunction } from 'express';
export interface AuthPayload {
    userId: string;
    role: 'TEACHER' | 'STUDENT' | 'ADMIN';
}
export declare function signToken(payload: AuthPayload): string;
export declare function verifyToken(token: string): AuthPayload;
export declare function authMiddleware(req: Request, res: Response, next: NextFunction): void;
export declare function teacherOnly(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=auth.d.ts.map