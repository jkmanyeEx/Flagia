"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const database_1 = __importDefault(require("../database"));
const auth_1 = require("../middleware/auth");
const flagiaEngine_1 = require("../engine/flagiaEngine");
const websocket_1 = require("../websocket");
const router = (0, express_1.Router)();
// POST /api/submissions — create or get existing submission for student+assignment
router.post('/', auth_1.authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        const { assignmentId } = req.body;
        if (!assignmentId) {
            res.status(400).json({ error: '과제 ID가 필요합니다' });
            return;
        }
        // Check if submission already exists
        const [existing] = await database_1.default.query('SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?', [assignmentId, user.userId]);
        const submissions = existing;
        if (submissions.length > 0) {
            const sub = submissions[0];
            // Opening the editor on an ASSIGNED submission means writing has begun.
            if (sub.status === 'ASSIGNED') {
                await database_1.default.query(`UPDATE submissions SET status = 'IN_PROGRESS' WHERE id = ? AND status = 'ASSIGNED'`, [sub.id]);
                sub.status = 'IN_PROGRESS';
                (0, websocket_1.notifySubmissionsUpdate)(assignmentId, user.userId);
            }
            res.json(sub);
            return;
        }
        // Authorization for classroom assignments: the student must be a member.
        // Standalone assignments (classroom_id NULL) keep the legacy open behavior.
        const [aRows] = await database_1.default.query('SELECT classroom_id FROM assignments WHERE id = ?', [assignmentId]);
        const assignment = aRows[0];
        if (!assignment) {
            res.status(404).json({ error: '과제를 찾을 수 없습니다' });
            return;
        }
        if (assignment.classroom_id) {
            const [m] = await database_1.default.query('SELECT id FROM classroom_members WHERE classroom_id = ? AND student_id = ?', [assignment.classroom_id, user.userId]);
            if (m.length === 0) {
                res.status(403).json({ error: '학급에 참여한 학생만 과제를 시작할 수 있습니다' });
                return;
            }
        }
        // Create new submission
        const id = (0, uuid_1.v4)();
        await database_1.default.query(`INSERT INTO submissions (id, assignment_id, student_id, status)
       VALUES (?, ?, ?, 'IN_PROGRESS')`, [id, assignmentId, user.userId]);
        const [newSub] = await database_1.default.query('SELECT * FROM submissions WHERE id = ?', [id]);
        (0, websocket_1.notifySubmissionsUpdate)(assignmentId, user.userId);
        res.status(201).json(newSub[0]);
    }
    catch (err) {
        console.error('Create submission error:', err);
        res.status(500).json({ error: '제출물을 생성할 수 없습니다' });
    }
});
// PUT /api/submissions/:id/submit — finalize submission and trigger analysis
router.put('/:id/submit', auth_1.authMiddleware, async (req, res) => {
    try {
        const { finalMarkdown, forceClose } = req.body;
        const status = forceClose ? 'FORCE_CLOSED' : 'SUBMITTED';
        // Update the submission text and status
        await database_1.default.query(`UPDATE submissions SET final_markdown = ?, status = ?, submitted_at = NOW()
       WHERE id = ? AND status = 'IN_PROGRESS'`, [finalMarkdown || '', status, req.params.id]);
        // Get submission with assignment info for analysis
        const [rows] = await database_1.default.query(`SELECT s.*, a.template_text, a.mode, a.text_limit
       FROM submissions s
       JOIN assignments a ON s.assignment_id = a.id
       WHERE s.id = ?`, [req.params.id]);
        const submission = rows[0];
        if (!submission) {
            res.status(404).json({ error: '제출물을 찾을 수 없습니다' });
            return;
        }
        // Gather all session events for analysis
        const [sessionRows] = await database_1.default.query('SELECT events_blob FROM sessions WHERE submission_id = ? ORDER BY start_time ASC', [req.params.id]);
        const allEvents = [];
        for (const session of sessionRows) {
            if (session.events_blob) {
                try {
                    const parsed = JSON.parse(session.events_blob);
                    if (Array.isArray(parsed))
                        allEvents.push(...parsed);
                }
                catch { /* skip malformed blob */ }
            }
        }
        // Run Flagia analysis engine safely
        let analysis;
        try {
            analysis = (0, flagiaEngine_1.runFlagiaAnalysis)(allEvents, submission.final_markdown || '', submission.template_text || '', submission.mode, submission.submitted_at);
            // Update submission with analysis results + cache full analysis JSON
            await database_1.default.query(`UPDATE submissions SET
          flagia_score = ?, flag_status = ?,
          coefficient_of_variation = ?, revision_ratio = ?,
          total_paste_count = ?, total_blur_duration = ?,
          analysis_json = ?
         WHERE id = ?`, [
                analysis.flagiaScore,
                analysis.flagStatus,
                analysis.coefficientOfVariation,
                analysis.revisionRatio,
                analysis.totalPasteCount,
                analysis.totalBlurDuration,
                JSON.stringify(analysis),
                req.params.id,
            ]);
        }
        catch (engineErr) {
            console.error('Flagia Analysis Engine Error:', engineErr);
            // Even if analysis fails, we don't revert the submission status.
            // The student has successfully submitted.
        }
        (0, websocket_1.notifySubmissionsUpdate)(submission.assignment_id, submission.student_id);
        res.json({ message: '제출 완료', analysis: analysis || null });
    }
    catch (err) {
        console.error('Submit error:', err);
        res.status(500).json({ error: '제출 처리 중 오류가 발생했습니다' });
    }
});
// PUT /api/submissions/:id/draft — periodic auto-save of in-progress work.
// Persists the latest markdown and the cumulative active writing time so the
// countdown timer can resume (rather than reset) when the student reopens the
// editor. time_spent_sec is clamped monotonically (GREATEST) and capped at the
// assignment's time budget, so it can never be rolled back to gain extra time.
router.put('/:id/draft', auth_1.authMiddleware, async (req, res) => {
    try {
        const { markdown, timeSpentSec } = req.body;
        const safeSpent = Math.max(0, Math.floor(Number(timeSpentSec) || 0));
        await database_1.default.query(`UPDATE submissions s
       JOIN assignments a ON s.assignment_id = a.id
       SET s.final_markdown = COALESCE(?, s.final_markdown),
           s.time_spent_sec = LEAST(a.time_limit * 60, GREATEST(s.time_spent_sec, ?))
       WHERE s.id = ? AND s.status = 'IN_PROGRESS'`, [markdown ?? null, safeSpent, req.params.id]);
        res.json({ ok: true });
    }
    catch (err) {
        console.error('Draft save error:', err);
        res.status(500).json({ error: '임시 저장에 실패했습니다' });
    }
});
// GET /api/submissions/:id/analysis — detailed analysis data
router.get('/:id/analysis', auth_1.authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        // Get submission with student/assignment info
        const [rows] = await database_1.default.query(`SELECT s.*, a.title as assignment_title, a.template_text, a.mode, a.text_limit,
              a.time_limit, a.max_score, u.name as student_name, u.email as student_email
       FROM submissions s
       JOIN assignments a ON s.assignment_id = a.id
       JOIN users u ON s.student_id = u.id
       WHERE s.id = ?`, [req.params.id]);
        const submission = rows[0];
        if (!submission) {
            res.status(404).json({ error: '제출물을 찾을 수 없습니다' });
            return;
        }
        // Permission check: teacher can view any, student can view own only
        if (user.role === 'STUDENT' && submission.student_id !== user.userId) {
            res.status(403).json({ error: '접근 권한이 없습니다' });
            return;
        }
        // Students get only the final score + session summary — NOT the rubric
        // (component scores, weights, Cv/RR, verdict, timeline, score adjustments).
        // Exposing those — even via the network tab — would let them reverse-engineer
        // and game the engine. Staff (teacher/admin) get the full breakdown.
        const isStudent = user.role === 'STUDENT';
        const trimForStudent = (a) => (a ? {
            version: a.version,
            flagiaScore: a.flagiaScore,
            flagStatus: a.flagStatus,
            sessionSummary: a.sessionSummary,
        } : null);
        // If cached analysis exists and is up to date (version 3), return it
        if (submission.analysis_json) {
            try {
                const cached = JSON.parse(submission.analysis_json);
                if (cached && cached.version === 3) {
                    res.json({
                        submission: {
                            id: submission.id,
                            assignmentId: submission.assignment_id,
                            assignmentTitle: submission.assignment_title,
                            templateText: submission.template_text,
                            studentName: submission.student_name,
                            studentEmail: submission.student_email,
                            status: submission.status,
                            submittedAt: submission.submitted_at,
                            finalMarkdown: submission.final_markdown,
                            mode: submission.mode,
                            textLimit: submission.text_limit,
                            timeLimit: submission.time_limit,
                            score: submission.score,
                            feedback: submission.feedback,
                            maxScore: submission.max_score,
                        },
                        analysis: isStudent ? trimForStudent(cached) : cached,
                    });
                    return;
                }
            }
            catch { /* recompute */ }
        }
        // Recompute analysis if not cached
        const [sessionRows] = await database_1.default.query(`SELECT id, start_time, end_time, ip_address, user_agent, events_blob
       FROM sessions WHERE submission_id = ? ORDER BY start_time ASC`, [req.params.id]);
        const allEvents = [];
        const sessions = sessionRows;
        for (const session of sessions) {
            if (session.events_blob) {
                try {
                    const parsed = JSON.parse(session.events_blob);
                    if (Array.isArray(parsed))
                        allEvents.push(...parsed);
                }
                catch { /* skip */ }
            }
        }
        const analysis = (0, flagiaEngine_1.runFlagiaAnalysis)(allEvents, submission.final_markdown || '', submission.template_text || '', submission.mode, submission.submitted_at);
        // Update session count in summary
        analysis.sessionSummary.sessionCount = sessions.length;
        // Cache it
        await database_1.default.query('UPDATE submissions SET analysis_json = ? WHERE id = ?', [JSON.stringify(analysis), req.params.id]);
        res.json({
            submission: {
                id: submission.id,
                assignmentId: submission.assignment_id,
                assignmentTitle: submission.assignment_title,
                templateText: submission.template_text,
                studentName: submission.student_name,
                studentEmail: submission.student_email,
                status: submission.status,
                submittedAt: submission.submitted_at,
                finalMarkdown: submission.final_markdown,
                mode: submission.mode,
                textLimit: submission.text_limit,
                timeLimit: submission.time_limit,
                score: submission.score,
                feedback: submission.feedback,
                maxScore: submission.max_score,
            },
            analysis: isStudent ? trimForStudent(analysis) : analysis,
        });
    }
    catch (err) {
        console.error('Analysis error:', err);
        res.status(500).json({ error: '분석 데이터를 불러올 수 없습니다' });
    }
});
// GET /api/submissions/:id/events — raw events list for replay
router.get('/:id/events', auth_1.authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        // Get submission
        const [rows] = await database_1.default.query('SELECT student_id FROM submissions WHERE id = ?', [req.params.id]);
        const submission = rows[0];
        if (!submission) {
            res.status(404).json({ error: '제출물을 찾을 수 없습니다' });
            return;
        }
        // Permission check: teacher can view any, student can view own only
        if (user.role === 'STUDENT' && submission.student_id !== user.userId) {
            res.status(403).json({ error: '접근 권한이 없습니다' });
            return;
        }
        // Gather all session events
        const [sessionRows] = await database_1.default.query('SELECT events_blob FROM sessions WHERE submission_id = ? ORDER BY start_time ASC', [req.params.id]);
        const allEvents = [];
        const sessions = sessionRows;
        for (const session of sessions) {
            if (session.events_blob) {
                try {
                    const parsed = JSON.parse(session.events_blob);
                    if (Array.isArray(parsed))
                        allEvents.push(...parsed);
                }
                catch { /* skip */ }
            }
        }
        res.json({ events: allEvents });
    }
    catch (err) {
        console.error('Fetch events error:', err);
        res.status(500).json({ error: '이벤트를 불러올 수 없습니다' });
    }
});
// POST /api/submissions/:id/beacon — fired on window close via sendBeacon.
// Every assignment is resumable, so this never submits: it just persists the
// latest draft and leaves the submission IN_PROGRESS. The actual "left the
// site" timestamp is recorded server-side as a `leave` event when the
// WebSocket disconnects (see websocket.ts).
router.post('/:id/beacon', async (req, res) => {
    try {
        const { finalMarkdown, timeSpentSec, events } = req.body;
        const safeSpent = Math.max(0, Math.floor(Number(timeSpentSec) || 0));
        await database_1.default.query(`UPDATE submissions s
       JOIN assignments a ON s.assignment_id = a.id
       SET s.final_markdown = ?,
           s.time_spent_sec = LEAST(a.time_limit * 60, GREATEST(s.time_spent_sec, ?))
       WHERE s.id = ? AND s.status = 'IN_PROGRESS'`, [finalMarkdown || '', safeSpent, req.params.id]);
        // Safety net for keystroke telemetry: if the WebSocket dropped (deploy,
        // network, tunnel hiccup) before the buffer flushed, the client sends the
        // un-flushed events here on unload. Append them to the most recent session
        // (or create one) so the writing process isn't lost.
        if (Array.isArray(events) && events.length > 0) {
            const [sRows] = await database_1.default.query('SELECT id, events_blob FROM sessions WHERE submission_id = ? ORDER BY start_time DESC LIMIT 1', [req.params.id]);
            let sessionRow = sRows[0];
            if (!sessionRow) {
                const newId = (0, uuid_1.v4)();
                await database_1.default.query(`INSERT INTO sessions (id, submission_id, start_time, events_blob) VALUES (?, ?, NOW(), '[]')`, [newId, req.params.id]);
                sessionRow = { id: newId, events_blob: '[]' };
            }
            let existing = [];
            if (sessionRow.events_blob) {
                try {
                    existing = JSON.parse(sessionRow.events_blob);
                }
                catch {
                    existing = [];
                }
            }
            existing.push(...events);
            await database_1.default.query('UPDATE sessions SET events_blob = ? WHERE id = ?', [JSON.stringify(existing), sessionRow.id]);
        }
        const [subRows] = await database_1.default.query('SELECT assignment_id, student_id FROM submissions WHERE id = ?', [req.params.id]);
        const sub = subRows[0];
        if (sub) {
            (0, websocket_1.notifySubmissionsUpdate)(sub.assignment_id, sub.student_id);
        }
        res.status(200).json({ ok: true });
    }
    catch (err) {
        console.error('Beacon submit error:', err);
        res.status(500).json({ error: 'Beacon submit failed' });
    }
});
// POST /api/submissions/:id/events — REST fallback for event batch ingest
router.post('/:id/events', auth_1.authMiddleware, async (req, res) => {
    try {
        const { sessionId, events } = req.body;
        if (!sessionId || !events) {
            res.status(400).json({ error: 'sessionId와 events가 필요합니다' });
            return;
        }
        // Append events to session blob
        const [rows] = await database_1.default.query('SELECT events_blob FROM sessions WHERE id = ?', [sessionId]);
        const session = rows[0];
        if (!session) {
            res.status(404).json({ error: '세션을 찾을 수 없습니다' });
            return;
        }
        let existingEvents = [];
        if (session.events_blob) {
            try {
                existingEvents = JSON.parse(session.events_blob);
            }
            catch { /* reset if malformed */ }
        }
        existingEvents.push(...events);
        await database_1.default.query('UPDATE sessions SET events_blob = ? WHERE id = ?', [
            JSON.stringify(existingEvents),
            sessionId,
        ]);
        res.json({ received: events.length, total: existingEvents.length });
    }
    catch (err) {
        console.error('Event ingest error:', err);
        res.status(500).json({ error: '이벤트 저장 실패' });
    }
});
// POST /api/submissions/:id/grade — grade a submission (teacher only)
router.post('/:id/grade', auth_1.authMiddleware, auth_1.teacherOnly, async (req, res) => {
    try {
        const user = req.user;
        const { score, feedback } = req.body;
        // Only the owning teacher (or owning admin) may grade.
        const [ownerRows] = await database_1.default.query(`SELECT a.teacher_id FROM submissions s JOIN assignments a ON s.assignment_id = a.id WHERE s.id = ?`, [req.params.id]);
        const owner = ownerRows[0];
        if (!owner) {
            res.status(404).json({ error: '제출물을 찾을 수 없습니다' });
            return;
        }
        if (owner.teacher_id !== user.userId && user.role !== 'ADMIN') {
            res.status(403).json({ error: '본인이 만든 과제의 제출물만 채점할 수 있습니다' });
            return;
        }
        await database_1.default.query('UPDATE submissions SET score = ?, feedback = ? WHERE id = ?', [score !== undefined && score !== null ? score : null, feedback || null, req.params.id]);
        // Also update cached analysis_json if it exists to keep everything in sync
        const [subRows] = await database_1.default.query('SELECT assignment_id, student_id FROM submissions WHERE id = ?', [req.params.id]);
        const sub = subRows[0];
        if (sub) {
            (0, websocket_1.notifySubmissionsUpdate)(sub.assignment_id, sub.student_id);
        }
        res.json({ message: '성공적으로 채점되었습니다', score, feedback });
    }
    catch (err) {
        console.error('Grade submission error:', err);
        res.status(500).json({ error: '채점 정보를 저장할 수 없습니다' });
    }
});
// DELETE /api/submissions/:id — delete submission (teacher only)
router.delete('/:id', auth_1.authMiddleware, auth_1.teacherOnly, async (req, res) => {
    try {
        const user = req.user;
        // Get submission info to check ownership
        const [subRows] = await database_1.default.query(`SELECT s.assignment_id, s.student_id, a.teacher_id 
       FROM submissions s 
       JOIN assignments a ON s.assignment_id = a.id 
       WHERE s.id = ?`, [req.params.id]);
        const sub = subRows[0];
        if (!sub) {
            res.status(404).json({ error: '제출물을 찾을 수 없습니다' });
            return;
        }
        // Only assignment owner teacher or admin may delete
        if (sub.teacher_id !== user.userId && user.role !== 'ADMIN') {
            res.status(403).json({ error: '본인이 만든 과제의 제출물만 삭제할 수 있습니다' });
            return;
        }
        // Delete all sessions for this submission
        await database_1.default.query('DELETE FROM sessions WHERE submission_id = ?', [req.params.id]);
        // Reset the submission fields back to ASSIGNED
        await database_1.default.query(`UPDATE submissions SET
         status = 'ASSIGNED',
         final_markdown = NULL,
         time_spent_sec = 0,
         score = NULL,
         feedback = NULL,
         submitted_at = NULL,
         flagia_score = NULL,
         flag_status = NULL,
         coefficient_of_variation = NULL,
         revision_ratio = NULL,
         total_paste_count = 0,
         total_blur_duration = 0,
         analysis_json = NULL
       WHERE id = ?`, [req.params.id]);
        // Notify student and teacher of updates
        (0, websocket_1.notifySubmissionsUpdate)(sub.assignment_id, sub.student_id);
        res.json({ message: '제출물이 초기화되었습니다' });
    }
    catch (err) {
        console.error('Delete submission error:', err);
        res.status(500).json({ error: '제출물을 삭제할 수 없습니다' });
    }
});
exports.default = router;
//# sourceMappingURL=submissions.js.map