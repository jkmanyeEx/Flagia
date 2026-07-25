"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const http_1 = __importDefault(require("http"));
const websocket_1 = require("./websocket");
const auth_1 = __importDefault(require("./routes/auth"));
const assignments_1 = __importDefault(require("./routes/assignments"));
const submissions_1 = __importDefault(require("./routes/submissions"));
const classrooms_1 = __importDefault(require("./routes/classrooms"));
const database_1 = __importDefault(require("./database"));
const migrate_1 = require("./migrate");
const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';
const allowedOrigins = (process.env.CORS_ORIGINS ||
    'https://flagia.kr,https://www.flagia.kr,http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
app.set('trust proxy', 1);
app.use((0, cors_1.default)({
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
app.use(express_1.default.json({ limit: '10mb' }));
// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});
// Server time sync endpoint
app.get('/api/time', (_req, res) => {
    res.json({ serverTime: Date.now() });
});
// Routes
app.use('/api/auth', auth_1.default);
app.use('/api/classrooms', classrooms_1.default);
app.use('/api/assignments', assignments_1.default);
app.use('/api/submissions', submissions_1.default);
// Create HTTP server and attach WebSocket
const server = http_1.default.createServer(app);
(0, websocket_1.initWebSocket)(server);
// Initialize DB and start
async function start() {
    try {
        const conn = await database_1.default.getConnection();
        console.log('✅ MySQL connected');
        conn.release();
        console.log('🔧 Ensuring schema is up to date...');
        await (0, migrate_1.ensureSchema)();
        server.listen(PORT, HOST, () => {
            console.log(`🚀 Flagia backend running on ${HOST}:${PORT}`);
        });
    }
    catch (err) {
        console.error('❌ Failed to start:', err);
        process.exit(1);
    }
}
start();
//# sourceMappingURL=index.js.map