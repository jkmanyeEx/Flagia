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
exports.invalidateSubmissionLiveSession = invalidateSubmissionLiveSession;
exports.notifyClassroomMembersUpdate = notifyClassroomMembersUpdate;
exports.initWebSocket = initWebSocket;
const ws_1 = require("ws");
const uuid_1 = require("uuid");
const database_1 = __importDefault(require("./database"));
const auth_1 = require("./middleware/auth");
const submissionFinalizer_1 = require("./services/submissionFinalizer");
const MAX_LIVE_UPDATES_PER_SECOND = 10;
const MAX_LIVE_CONTENT_CHARS = 100_000;
const MAX_LIVE_CONTENT_BYTES = 400_000;
const MAX_LIVE_MESSAGE_BYTES = 450_000;
const MAX_LIVE_CLOCK_SKEW_MS = 5 * 60 * 1000;
// Track connected clients
const clients = new Map();
// Track assignment rooms for teacher broadcasts
const assignmentRooms = new Map();
// Prevent two teacher sockets from running the same assignment-wide transition
// concurrently. The database status predicate remains the final safety net.
const forceSubmitInProgress = new Set();
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function send(ws, type, payload) {
    if (ws.readyState === ws_1.WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify({ type, payload }));
        }
        catch {
            // A single socket failing during a broadcast must not affect peers.
        }
    }
}
function notifySubmissionsUpdate(assignmentId, studentId) {
    for (const client of clients.values()) {
        if (((client.user?.role === 'TEACHER' || client.user?.role === 'ADMIN') &&
            client.assignmentId === assignmentId) ||
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
// Push a student's current plain-text content to any teacher/admin live-watching
// that submission (used for real-time monitoring of in-progress writing).
function broadcastSubmissionContent(submissionId, content, metadata) {
    for (const client of clients.values()) {
        if (client.watchSubmissionId === submissionId && client.ws.readyState === ws_1.WebSocket.OPEN) {
            send(client.ws, 'submission_content_update', {
                submissionId,
                content,
                ...metadata,
            });
        }
    }
}
// Submission finalization happens through both HTTP routes and the WebSocket
// force-submit fallback. Invalidate the join-time authorization cache so a
// stale/malicious student socket cannot keep relaying after the status changes.
function invalidateSubmissionLiveSession(submissionId) {
    for (const client of clients.values()) {
        if (client.joinedSubmission?.submissionId === submissionId) {
            client.joinedSubmission = undefined;
        }
    }
}
function notifyClassroomMembersUpdate(classroomId) {
    for (const client of clients.values()) {
        if (client.classroomId === classroomId && client.ws.readyState === ws_1.WebSocket.OPEN) {
            client.ws.send(JSON.stringify({
                type: 'classroom_members_update',
                payload: { classroomId }
            }));
        }
    }
}
function initWebSocket(server) {
    const wss = new ws_1.WebSocketServer({
        server,
        path: '/ws',
        // Preserve room for the existing telemetry batches while still bounding
        // pathological frames. Live content has a much smaller per-message limit.
        maxPayload: 10 * 1024 * 1024,
    });
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
                        // Verify status, assignment, and ownership before adding this socket
                        // to a force-close room.
                        const [subRows] = await database_1.default.query(`SELECT s.status, s.assignment_id, s.student_id, a.text_limit
               FROM submissions s
               JOIN assignments a ON a.id = s.assignment_id
               WHERE s.id = ?`, [submissionId]);
                        const sub = subRows[0];
                        if (!sub ||
                            sub.status !== 'IN_PROGRESS' ||
                            sub.assignment_id !== assignmentId ||
                            sub.student_id !== clientState.user.userId ||
                            (clientState.user.role !== 'STUDENT' && clientState.user.role !== 'ADMIN')) {
                            ws.send(JSON.stringify({
                                type: 'error',
                                payload: { error: '본인의 진행 중인 제출물만 세션에 참여할 수 있습니다' }
                            }));
                            break;
                        }
                        clientState.submissionId = submissionId;
                        clientState.assignmentId = assignmentId;
                        clientState.joinedSubmission = {
                            submissionId,
                            assignmentId,
                            studentId: clientState.user.userId,
                            status: 'IN_PROGRESS',
                            maxContentLength: Math.min(Math.max(0, Number(sub.text_limit) || 0), MAX_LIVE_CONTENT_CHARS),
                        };
                        clientState.lastLiveRevision = 0;
                        clientState.liveUpdateTimestamps = [];
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
                    // ── Ephemeral student content relay (never persisted) ──
                    case 'live_content_update': {
                        if (!clientState ||
                            (clientState.user.role !== 'STUDENT' && clientState.user.role !== 'ADMIN'))
                            break;
                        if (!payload || typeof payload !== 'object')
                            break;
                        const joined = clientState.joinedSubmission;
                        const { submissionId, assignmentId, content, revision, sentAt } = payload;
                        const now = Date.now();
                        if (!joined ||
                            joined.status !== 'IN_PROGRESS' ||
                            typeof submissionId !== 'string' ||
                            typeof assignmentId !== 'string' ||
                            submissionId !== joined.submissionId ||
                            assignmentId !== joined.assignmentId ||
                            joined.studentId !== clientState.user.userId ||
                            clientState.submissionId !== submissionId ||
                            typeof content !== 'string' ||
                            !Number.isSafeInteger(revision) ||
                            revision <= 0 ||
                            revision <= (clientState.lastLiveRevision || 0) ||
                            !Number.isSafeInteger(sentAt) ||
                            sentAt <= 0 ||
                            Math.abs(now - sentAt) > MAX_LIVE_CLOCK_SKEW_MS) {
                            break;
                        }
                        const rawBytes = Buffer.byteLength(raw.toString(), 'utf8');
                        const contentBytes = Buffer.byteLength(content, 'utf8');
                        const contentLength = Array.from(content).length;
                        if (rawBytes > MAX_LIVE_MESSAGE_BYTES ||
                            contentBytes > MAX_LIVE_CONTENT_BYTES ||
                            contentLength > joined.maxContentLength) {
                            break;
                        }
                        const recent = (clientState.liveUpdateTimestamps || []).filter(timestamp => now - timestamp < 1000);
                        if (recent.length >= MAX_LIVE_UPDATES_PER_SECOND) {
                            clientState.liveUpdateTimestamps = recent;
                            break;
                        }
                        recent.push(now);
                        clientState.liveUpdateTimestamps = recent;
                        clientState.lastLiveRevision = revision;
                        broadcastSubmissionContent(submissionId, content, {
                            revision,
                            sentAt,
                            source: 'live',
                        });
                        break;
                    }
                    // ── Batch keystroke event ingestion ──
                    case 'event_batch': {
                        if (!clientState?.sessionId)
                            break;
                        const { events, batchId } = payload;
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
                            payload: { received: events.length, total: existingEvents.length, batchId },
                        }));
                        // Live sync: if this batch carried a snapshot, push the latest plain
                        // text to any teacher/admin watching this submission.
                        if (clientState.submissionId &&
                            clientState.joinedSubmission?.submissionId === clientState.submissionId) {
                            const snaps = events.filter((e) => e.type === 'snapshot' && typeof e.meta?.text === 'string');
                            if (snaps.length > 0) {
                                const latestSnapshot = snaps[snaps.length - 1];
                                broadcastSubmissionContent(clientState.submissionId, latestSnapshot.meta.text, {
                                    revision: 0,
                                    sentAt: Number.isSafeInteger(latestSnapshot.timestamp)
                                        ? latestSnapshot.timestamp
                                        : Date.now(),
                                    source: 'snapshot',
                                });
                            }
                        }
                        break;
                    }
                    // ── Teacher/admin: start/stop live-watching a student's writing ──
                    case 'watch_submission': {
                        if (!clientState || (clientState.user.role !== 'TEACHER' && clientState.user.role !== 'ADMIN'))
                            break;
                        const { submissionId } = payload;
                        if (!submissionId)
                            break;
                        const [watchRows] = await database_1.default.query(`SELECT a.teacher_id
               FROM submissions s
               JOIN assignments a ON a.id = s.assignment_id
               WHERE s.id = ?`, [submissionId]);
                        const watched = watchRows[0];
                        if (!watched || (clientState.user.role !== 'ADMIN' && watched.teacher_id !== clientState.user.userId)) {
                            send(ws, 'error', { error: '해당 제출물을 실시간으로 볼 권한이 없습니다' });
                            break;
                        }
                        clientState.watchSubmissionId = submissionId;
                        // Send the current latest snapshot immediately so the teacher sees
                        // the student's present content without waiting for the next flush.
                        try {
                            const [rows] = await database_1.default.query('SELECT events_blob FROM sessions WHERE submission_id = ? ORDER BY start_time ASC', [submissionId]);
                            let latest = '';
                            let latestSentAt = 0;
                            let foundSnapshot = false;
                            for (const r of rows) {
                                if (!r.events_blob)
                                    continue;
                                try {
                                    const evs = JSON.parse(r.events_blob);
                                    for (const e of evs) {
                                        if (e.type === 'snapshot' && typeof e.meta?.text === 'string') {
                                            latest = e.meta.text;
                                            latestSentAt = Number.isSafeInteger(e.timestamp) ? e.timestamp : latestSentAt;
                                            foundSnapshot = true;
                                        }
                                    }
                                }
                                catch { /* skip */ }
                            }
                            if (foundSnapshot) {
                                ws.send(JSON.stringify({
                                    type: 'submission_content_update',
                                    payload: {
                                        submissionId,
                                        content: latest,
                                        revision: 0,
                                        sentAt: latestSentAt,
                                        source: 'snapshot',
                                    },
                                }));
                            }
                        }
                        catch { /* noop */ }
                        break;
                    }
                    case 'unwatch_submission': {
                        if (clientState)
                            clientState.watchSubmissionId = undefined;
                        break;
                    }
                    // ── Teacher/admin: end every active writing session in an assignment ──
                    case 'force_submit': {
                        const requestId = payload?.requestId;
                        if (!clientState) {
                            send(ws, 'force_submit_error', { requestId, code: 'UNAUTHENTICATED', error: '인증이 필요합니다' });
                            break;
                        }
                        if (clientState.user.role !== 'TEACHER' && clientState.user.role !== 'ADMIN') {
                            send(ws, 'force_submit_error', { requestId, code: 'FORBIDDEN', error: '교사 또는 관리자 권한이 필요합니다' });
                            break;
                        }
                        const killAssignment = payload?.assignmentId;
                        if (!killAssignment) {
                            send(ws, 'force_submit_error', { requestId, code: 'INVALID_REQUEST', error: '과제 ID가 필요합니다' });
                            break;
                        }
                        const [assignmentRows] = await database_1.default.query('SELECT id, teacher_id FROM assignments WHERE id = ?', [killAssignment]);
                        const assignment = assignmentRows[0];
                        if (!assignment) {
                            send(ws, 'force_submit_error', { requestId, code: 'NOT_FOUND', error: '과제를 찾을 수 없습니다' });
                            break;
                        }
                        if (clientState.user.role !== 'ADMIN' && assignment.teacher_id !== clientState.user.userId) {
                            send(ws, 'force_submit_error', {
                                requestId,
                                code: 'FORBIDDEN',
                                error: '본인이 만든 과제의 작성 세션만 종료할 수 있습니다',
                            });
                            break;
                        }
                        if (forceSubmitInProgress.has(killAssignment)) {
                            send(ws, 'force_submit_error', {
                                requestId,
                                code: 'REQUEST_IN_PROGRESS',
                                error: '이 과제의 작성 종료 요청이 이미 처리 중입니다',
                            });
                            break;
                        }
                        forceSubmitInProgress.add(killAssignment);
                        try {
                            const [initialRows] = await database_1.default.query('SELECT id, student_id, status FROM submissions WHERE assignment_id = ?', [killAssignment]);
                            const initial = initialRows;
                            const targets = initial.filter(submission => submission.status === 'IN_PROGRESS');
                            const targetIds = new Set(targets.map(submission => submission.id));
                            const initiallySubmitted = initial.filter(submission => submission.status === 'SUBMITTED' || submission.status === 'FORCE_CLOSED').length;
                            // Send to every connected tab, but report unique submissions.
                            const deliveredSubmissionIds = new Set();
                            const room = assignmentRooms.get(killAssignment);
                            if (room) {
                                for (const cid of room) {
                                    const student = clients.get(cid);
                                    if (student?.submissionId &&
                                        targetIds.has(student.submissionId) &&
                                        student.ws.readyState === ws_1.WebSocket.OPEN) {
                                        send(student.ws, 'force_close', {
                                            reason: '교사에 의해 작성이 종료되었습니다',
                                            assignmentId: killAssignment,
                                        });
                                        deliveredSubmissionIds.add(student.submissionId);
                                    }
                                }
                            }
                            // Give connected editors time to flush their last snapshot and use
                            // the normal submit endpoint. Only submissions still IN_PROGRESS
                            // are claimed by the server-side fallback.
                            if (targets.length > 0)
                                await delay(2500);
                            const fallbackErrors = [];
                            for (const target of targets) {
                                try {
                                    const result = await (0, submissionFinalizer_1.finalizeSubmission)({
                                        submissionId: target.id,
                                        status: 'FORCE_CLOSED',
                                    });
                                    invalidateSubmissionLiveSession(target.id);
                                    if (result.outcome === 'finalized' && result.submission) {
                                        notifySubmissionsUpdate(result.submission.assignment_id, result.submission.student_id);
                                    }
                                    if (result.analysisError) {
                                        fallbackErrors.push({ submissionId: target.id, error: result.analysisError });
                                    }
                                }
                                catch (error) {
                                    fallbackErrors.push({
                                        submissionId: target.id,
                                        error: error instanceof Error ? error.message : '강제 종료 처리 오류',
                                    });
                                }
                            }
                            // Let a connected student's analysis update land before producing
                            // the aggregate result.
                            if (deliveredSubmissionIds.size > 0)
                                await delay(250);
                            let finalRows = [];
                            if (targets.length > 0) {
                                const [rows] = await database_1.default.query('SELECT id, status, analysis_json FROM submissions WHERE id IN (?)', [targets.map(target => target.id)]);
                                finalRows = rows;
                            }
                            const forceClosedCount = finalRows.filter(row => row.status === 'FORCE_CLOSED').length;
                            const submittedDuringGrace = finalRows.filter(row => row.status === 'SUBMITTED').length;
                            const stateFailedCount = targets.length - forceClosedCount - submittedDuringGrace;
                            const analysisFailedCount = finalRows.filter(row => row.status === 'FORCE_CLOSED' && !row.analysis_json).length;
                            const errorMessages = [
                                ...fallbackErrors.map(item => `${item.submissionId}: ${item.error}`),
                                ...(stateFailedCount > 0 ? [`${stateFailedCount}건의 상태 전환이 완료되지 않았습니다`] : []),
                                ...(analysisFailedCount > fallbackErrors.length
                                    ? [`${analysisFailedCount - fallbackErrors.length}건의 분석 결과가 저장되지 않았습니다`]
                                    : []),
                            ];
                            send(ws, 'force_submit_ack', {
                                requestId,
                                assignmentId: killAssignment,
                                targetCount: targets.length,
                                deliveredCount: deliveredSubmissionIds.size,
                                alreadySubmittedCount: initiallySubmitted + submittedDuringGrace,
                                forceClosedCount,
                                successCount: Math.max(0, forceClosedCount - analysisFailedCount),
                                failedCount: stateFailedCount + analysisFailedCount,
                                analysisFailedCount,
                                errors: errorMessages,
                            });
                        }
                        catch (error) {
                            console.error('Force submit error:', error);
                            send(ws, 'force_submit_error', {
                                requestId,
                                code: 'PROCESSING_ERROR',
                                error: error instanceof Error
                                    ? `작성 세션 종료 처리 중 오류가 발생했습니다: ${error.message}`
                                    : '작성 세션 종료 처리 중 오류가 발생했습니다',
                            });
                        }
                        finally {
                            forceSubmitInProgress.delete(killAssignment);
                        }
                        break;
                    }
                    // ── Teacher: join room to receive status updates ──
                    case 'teacher_join': {
                        if (!clientState || (clientState.user.role !== 'TEACHER' && clientState.user.role !== 'ADMIN'))
                            break;
                        const [rows] = await database_1.default.query('SELECT teacher_id FROM assignments WHERE id = ?', [payload.assignmentId]);
                        const assignment = rows[0];
                        if (assignment &&
                            (clientState.user.role === 'ADMIN' || assignment.teacher_id === clientState.user.userId)) {
                            clientState.assignmentId = payload.assignmentId;
                        }
                        else {
                            send(ws, 'error', { error: '해당 과제의 실시간 현황을 볼 권한이 없습니다' });
                        }
                        break;
                    }
                    // ── Join classroom room for student list live refresh ──
                    case 'join_classroom': {
                        if (!clientState)
                            break;
                        clientState.classroomId = payload.classroomId;
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
                send(ws, 'error', { error: '메시지 처리 중 오류 발생' });
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