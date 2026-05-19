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
const database_1 = __importDefault(require("./database"));
const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT || '3502', 10);
app.use((0, cors_1.default)({ origin: true, credentials: true }));
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
        server.listen(PORT, () => {
            console.log(`🚀 Flagia backend running on :${PORT}`);
        });
    }
    catch (err) {
        console.error('❌ Failed to start:', err);
        process.exit(1);
    }
}
start();
//# sourceMappingURL=index.js.map