"use strict";
/**
 * WebSocket Server for Flagia
 *
 * Handles real-time communication:
 * - Student session management (join/resume)
 * - Keystroke telemetry batch ingestion
 * - Teacher kill-switch broadcast
 * - Auto-submit on timer expiry
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifySubmissionsUpdate = notifySubmissionsUpdate;
exports.notifyAssignmentsUpdate = notifyAssignmentsUpdate;
exports.initWebSocket = initWebSocket;
const ws_1 = require("ws");
const uuid_1 = require("uuid");
const database_1 = __importDefault(require("./database"));
const auth_1 = require("./middleware/auth");
// Track connected clients
const clients = new Map();
// Track assignment rooms for teacher broadcasts
const assignmentRooms = new Map();
function notifySubmissionsUpdate(assignmentId, studentId) {
    for (const client of clients.values()) {
        if ((client.user?.role === 'TEACHER' && client.assignmentId === assignmentId) ||
            (studentId && client.user?.userId === studentId && client.user?.role === 'STUDENT')) {
            if (client.ws.readyState === ws_1.WebSocket.OPEN) {
                client.ws.send(JSON.stringify({
                    type: 'submissions_update',
                    payload: { assignmentId, studentId }
                }));
            }
        }
    }
}
function notifyAssignmentsUpdate() {
    for (const client of clients.values()) {
        if (client.ws.readyState === ws_1.WebSocket.OPEN) {
            client.ws.send(JSON.stringify({
                type: 'assignments_update',
                payload: {}
            }));
        }
    }
}
function initWebSocket(server) {
    const wss = new ws_1.WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws, req) => {
        let clientId = (0, uuid_1.v4)();
        let clientState = null;
        ws.on('message', async (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                const { type, payload } = msg;
                switch (type) {
                    // ── Authentication ──
                    case 'auth': {
                        try {
                            const user = (0, auth_1.verifyToken)(payload.token);
                            clientState = { ws, user };
                            clients.set(clientId, clientState);
                            ws.send(JSON.stringify({ type: 'auth_ok', payload: { userId: user.userId, role: user.role } }));
                        }
                        catch {
                            ws.send(JSON.stringify({ type: 'auth_error', payload: { error: '인증 실패' } }));
                            ws.close();
                        }
                        break;
                    }
                    // ── Student joins a writing session ──
                    case 'join_session': {
                        if (!clientState) {
                            ws.send(JSON.stringify({ type: 'error', payload: { error: '먼저 인증해 주세요' } }));
                            break;
                        }
                        const { submissionId, assignmentId } = payload;
                        clientState.submissionId = submissionId;
                        clientState.assignmentId = assignmentId;
                        // Create a new session record
                        const sessionId = (0, uuid_1.v4)();
                        const ip = req.headers['x-forwarded-for']?.toString().split(',')[0] || req.socket.remoteAddress || '';
                        const userAgent = req.headers['user-agent'] || '';
                        // If this submission already has prior sessions, the student is
                        // resuming after having left the site. Seed the new session with a
                        // `reconnect` marker (server time) so the analysis engine can pair
                        // it with the previous `leave` and exclude that disconnected gap
                        // from writing time. Both markers use server time, so the gap
                        // duration is accurate regardless of any client clock skew.
                        const [priorRows] = await database_1.default.query('SELECT COUNT(*) AS c FROM sessions WHERE submission_id = ?', [submissionId]);
                        const isResume = (priorRows[0]?.c || 0) > 0;
                        const seedBlob = isResume
                            ? JSON.stringify([{ seq: 0, timestamp: Date.now(), iki: 0, type: 'reconnect', meta: {}, currentHash: '' }])
                            : '[]';
                        await database_1.default.query(`INSERT INTO sessions (id, submission_id, start_time, ip_address, user_agent, events_blob)
               VALUES (?, ?, NOW(), ?, ?, ?)`, [sessionId, submissionId, ip, userAgent, seedBlob]);
                        clientState.sessionId = sessionId;
                        // Join assignment room for kill-switch
                        if (assignmentId) {
                            if (!assignmentRooms.has(assignmentId)) {
                                assignmentRooms.set(assignmentId, new Set());
                            }
                            assignmentRooms.get(assignmentId).add(clientId);
                        }
                        // Get server time for timer sync
                        ws.send(JSON.stringify({
                            type: 'session_ready',
                            payload: { sessionId, serverTime: Date.now() },
                        }));
                        // Notify submissions update
                        if (assignmentId) {
                            notifySubmissionsUpdate(assignmentId, clientState.user.userId);
                        }
                        break;
                    }
                    // ── Batch keystroke event ingestion ──
                    case 'event_batch': {
                        if (!clientState?.sessionId)
                            break;
                        const { events } = payload;
                        if (!Array.isArray(events) || events.length === 0)
                            break;
                        // Optional: verify hash chain integrity
                        // const chainResult = verifyHashChain(events);
                        // if (!chainResult.valid) { ... flag tampering ... }
                        // Append events to session blob (atomic read-modify-write)
                        const [rows] = await database_1.default.query('SELECT events_blob FROM sessions WHERE id = ?', [clientState.sessionId]);
                        const session = rows[0];
                        if (!session)
                            break;
                        let existingEvents = [];
                        if (session.events_blob) {
                            try {
                                existingEvents = JSON.parse(session.events_blob);
                            }
                            catch { /* reset */ }
                        }
                        existingEvents.push(...events);
                        await database_1.default.query('UPDATE sessions SET events_blob = ? WHERE id = ?', [JSON.stringify(existingEvents), clientState.sessionId]);
                        ws.send(JSON.stringify({
                            type: 'batch_ack',
                            payload: { received: events.length, total: existingEvents.length },
                        }));
                        break;
                    }
                    // ── Teacher: kill-switch for an assignment ──
                    case 'force_submit': {
                        if (!clientState || clientState.user.role !== 'TEACHER')
                            break;
                        const { assignmentId: killAssignment } = payload;
                        const room = assignmentRooms.get(killAssignment);
                        if (!room)
                            break;
                        // Broadcast force_close to all students in this assignment
                        for (const cid of room) {
                            const student = clients.get(cid);
                            if (student && student.ws.readyState === ws_1.WebSocket.OPEN) {
                                student.ws.send(JSON.stringify({
                                    type: 'force_close',
                                    payload: { reason: '교사에 의해 강제 종료되었습니다' },
                                }));
                            }
                        }
                        ws.send(JSON.stringify({ type: 'force_submit_ack', payload: { count: room.size } }));
                        break;
                    }
                    // ── Teacher: join room to receive status updates ──
                    case 'teacher_join': {
                        if (!clientState || clientState.user.role !== 'TEACHER')
                            break;
                        clientState.assignmentId = payload.assignmentId;
                        break;
                    }
                    // ── Student: timer expired, auto-submit ──
                    case 'timer_expired': {
                        if (!clientState?.submissionId)
                            break;
                        // Close the session
                        if (clientState.sessionId) {
                            await database_1.default.query('UPDATE sessions SET end_time = NOW() WHERE id = ?', [clientState.sessionId]);
                        }
                        ws.send(JSON.stringify({ type: 'submit_required', payload: { reason: '시간이 만료되었습니다' } }));
                        break;
                    }
                }
            }
            catch (err) {
                console.error('WebSocket message error:', err);
                ws.send(JSON.stringify({ type: 'error', payload: { error: '메시지 처리 중 오류 발생' } }));
            }
        });
        ws.on('close', async () => {
            const closedSessionId = clientState?.sessionId;
            const closedAssignmentId = clientState?.assignmentId;
            const closedUserId = clientState?.user?.userId;
            if (closedSessionId) {
                // Record a `leave` marker (student left the site / closed the tab) with
                // server time, then close the session. The engine pairs this with the
                // next session's `reconnect` marker to subtract the disconnected gap
                // from writing time.
                try {
                    const [rows] = await database_1.default.query('SELECT events_blob FROM sessions WHERE id = ?', [closedSessionId]);
                    const session = rows[0];
                    let evs = [];
                    if (session?.events_blob) {
                        try {
                            evs = JSON.parse(session.events_blob);
                        }
                        catch {
                            evs = [];
                        }
                    }
                    evs.push({ seq: 0, timestamp: Date.now(), iki: 0, type: 'leave', meta: {}, currentHash: '' });
                    await database_1.default.query('UPDATE sessions SET events_blob = ?, end_time = NOW() WHERE id = ? AND end_time IS NULL', [JSON.stringify(evs), closedSessionId]);
                }
                catch { /* noop */ }
            }
            // Remove from rooms
            if (closedAssignmentId) {
                assignmentRooms.get(closedAssignmentId)?.delete(clientId);
            }
            clients.delete(clientId);
            if (closedAssignmentId) {
                notifySubmissionsUpdate(closedAssignmentId, closedUserId);
            }
        });
        ws.on('error', (err) => {
            console.error('WebSocket error:', err);
        });
    });
    // Memory leak prevention: periodic cleanup of stale connections
    setInterval(() => {
        for (const [id, state] of clients) {
            if (state.ws.readyState === ws_1.WebSocket.CLOSED || state.ws.readyState === ws_1.WebSocket.CLOSING) {
                clients.delete(id);
                if (state.assignmentId) {
                    assignmentRooms.get(state.assignmentId)?.delete(id);
                }
            }
        }
        // Cleanup empty rooms
        for (const [roomId, members] of assignmentRooms) {
            if (members.size === 0)
                assignmentRooms.delete(roomId);
        }
    }, 30000);
    console.log('🔌 WebSocket server initialized on /ws');
}
//# sourceMappingURL=websocket.js.map