import express from 'express';
import cors from 'cors';
import http from 'http';
import { initWebSocket } from './websocket';
import authRouter from './routes/auth';
import assignmentsRouter from './routes/assignments';
import submissionsRouter from './routes/submissions';
import classroomsRouter from './routes/classrooms';
import pool from './database';

const app = express();
const PORT = parseInt(process.env.PORT || '3502', 10);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

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

    server.listen(PORT, () => {
      console.log(`🚀 Flagia backend running on :${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start:', err);
    process.exit(1);
  }
}

start();
