import express from 'express';
import cors from 'cors';
import http from 'http';
import { initWebSocket } from './websocket';
import authRouter from './routes/auth';
import assignmentsRouter from './routes/assignments';
import submissionsRouter from './routes/submissions';
import classroomsRouter from './routes/classrooms';
import pool from './database';
import { ensureSchema } from './migrate';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';

const allowedOrigins = (process.env.CORS_ORIGINS ||
  'https://flagia.kr,https://www.flagia.kr,http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.set('trust proxy', 1);
app.use(cors({
  origin(origin, callback) {
    // Requests without an Origin header are server-to-server/local health checks.
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('CORS origin is not allowed'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Attach stable, locale-independent codes to every user-facing REST error.
// Existing message text remains for older clients.
app.use((_req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = ((body: any) => {
    if (body?.error && !body.code) {
      const status = res.statusCode;
      const code =
        status === 401 ? 'UNAUTHENTICATED'
          : status === 403 ? 'FORBIDDEN'
            : status === 404 ? 'NOT_FOUND'
              : status === 409 ? 'CONFLICT'
                : status >= 500 ? 'SERVER_ERROR'
                  : 'INVALID_REQUEST';
      return originalJson({ ...body, code });
    }
    return originalJson(body);
  }) as typeof res.json;
  next();
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Server time sync endpoint
app.get('/api/time', (_req, res) => {
  res.json({ serverTime: Date.now() });
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/classrooms', classroomsRouter);
app.use('/api/assignments', assignmentsRouter);
app.use('/api/submissions', submissionsRouter);

// Create HTTP server and attach WebSocket
const server = http.createServer(app);
initWebSocket(server);

// Initialize DB and start
async function start() {
  try {
    const conn = await pool.getConnection();
    console.log('✅ MySQL connected');
    conn.release();

    console.log('🔧 Ensuring schema is up to date...');
    await ensureSchema();

    server.listen(PORT, HOST, () => {
      console.log(`🚀 Flagia backend running on ${HOST}:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start:', err);
    process.exit(1);
  }
}

start();
