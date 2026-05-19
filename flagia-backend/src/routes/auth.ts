import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import pool from '../database';
import { signToken } from '../middleware/auth';

const router = Router();

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
      res.status(400).json({ error: '모든 필드를 입력해 주세요' });
      return;
    }
    if (!['TEACHER', 'STUDENT'].includes(role)) {
      res.status(400).json({ error: '유효하지 않은 역할입니다' });
      return;
    }

    // Check duplicate
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if ((existing as any[]).length > 0) {
      res.status(409).json({ error: '이미 등록된 이메일입니다' });
      return;
    }

    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      'INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [id, name, email, passwordHash, role]
    );

    const token = signToken({ userId: id, role });
    res.status(201).json({ token, user: { id, name, email, role } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: '이메일과 비밀번호를 입력해 주세요' });
      return;
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    const users = rows as any[];
    if (users.length === 0) {
      res.status(401).json({ error: '등록되지 않은 이메일입니다' });
      return;
    }

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: '비밀번호가 일치하지 않습니다' });
      return;
    }

    const token = signToken({ userId: user.id, role: user.role });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
});

// GET /api/auth/me — validate token & return user profile
router.get('/me', async (req: Request, res: Response) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: '인증이 필요합니다' });
      return;
    }

    const { verifyToken } = await import('../middleware/auth');
    const payload = verifyToken(header.slice(7));

    const [rows] = await pool.query(
      'SELECT id, name, email, role FROM users WHERE id = ?',
      [payload.userId]
    );
    const users = rows as any[];
    if (users.length === 0) {
      res.status(401).json({ error: '사용자를 찾을 수 없습니다' });
      return;
    }

    res.json({ user: users[0] });
  } catch (err) {
    res.status(401).json({ error: '유효하지 않은 토큰입니다' });
  }
});

export default router;
