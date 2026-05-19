"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("./db");
const analytics_1 = require("./analytics");
const websocket_1 = require("./websocket");
const router = (0, express_1.Router)();
// Helper to run analytics and update submissions state in DB
async function runSubmissionsAnalytics(submissionId) {
    // 1. Fetch submission details and its assignment
    const [subRows] = await db_1.pool.query('SELECT s.*, a.templateText, a.sensitivityMode FROM submissions s JOIN assignments a ON s.assignmentId = a.id WHERE s.id = ?', [submissionId]);
    if (subRows.length === 0)
        return null;
    const submission = subRows[0];
    // 2. Fetch all keystrokes
    const [keystrokes] = await db_1.pool.query('SELECT * FROM keystrokes WHERE submissionId = ?', [submissionId]);
    // 3. Fetch all focus events
    const [focusEvents] = await db_1.pool.query('SELECT * FROM focus_events WHERE submissionId = ?', [submissionId]);
    // 4. Calculate stats
    const analytics = (0, analytics_1.calculateFlagiaScore)(submission.content || '', submission.templateText, keystrokes, focusEvents, submission.sensitivityMode);
    // 5. Update submission database record
    await db_1.pool.query('UPDATE submissions SET score = ?, riskFlag = ?, focusLostCount = ? WHERE id = ?', [analytics.score, analytics.riskFlag, analytics.focusLostCount, submissionId]);
    const updatedData = {
        id: submissionId,
        assignmentId: submission.assignmentId,
        studentName: submission.studentName,
        content: submission.content,
        score: analytics.score,
        riskFlag: analytics.riskFlag,
        focusLostCount: analytics.focusLostCount,
        status: submission.status,
        submittedAt: submission.submittedAt,
        ikiMean: analytics.ikiMean,
        ikiCv: analytics.ikiCv,
        revisionRatio: analytics.revisionRatio,
        suspiciousPastes: analytics.suspiciousPastes
    };
    // 6. Notify teachers
    (0, websocket_1.notifyTeachers)({
        type: 'submission_update',
        data: updatedData
    });
    return updatedData;
}
// GET assignments list
router.get('/assignments', async (req, res) => {
    try {
        const [rows] = await db_1.pool.query('SELECT * FROM assignments ORDER BY createdAt DESC');
        res.json(rows);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// GET assignment by ID
router.get('/assignments/:id', async (req, res) => {
    try {
        const [rows] = await db_1.pool.query('SELECT * FROM assignments WHERE id = ?', [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }
        res.json(rows[0]);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// POST create assignment
router.post('/assignments', async (req, res) => {
    try {
        const { title, templateText, textLimit, sensitivityMode, deadline } = req.body;
        if (!title || !deadline) {
            return res.status(400).json({ error: 'Title and deadline are required' });
        }
        const [result] = await db_1.pool.query('INSERT INTO assignments (title, templateText, textLimit, sensitivityMode, deadline) VALUES (?, ?, ?, ?, ?)', [title, templateText || '', textLimit || 500, sensitivityMode || 'Standard', new Date(deadline)]);
        res.status(201).json({ id: result.insertId, title, templateText, textLimit, sensitivityMode, deadline });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// POST start a student writing session (creates submission)
router.post('/submissions', async (req, res) => {
    try {
        const { assignmentId, studentName } = req.body;
        if (!assignmentId || !studentName) {
            return res.status(400).json({ error: 'Assignment ID and student name are required' });
        }
        // Check if assignment exists
        const [assignRows] = await db_1.pool.query('SELECT * FROM assignments WHERE id = ?', [assignmentId]);
        if (assignRows.length === 0) {
            return res.status(404).json({ error: 'Assignment not found' });
        }
        // Check if student already has a submission session for this assignment
        const [existing] = await db_1.pool.query('SELECT * FROM submissions WHERE assignmentId = ? AND studentName = ?', [assignmentId, studentName]);
        let submissionId;
        let initialContent = '';
        if (existing.length > 0) {
            submissionId = existing[0].id;
            initialContent = existing[0].content || '';
            console.log(`Reconnecting student ${studentName} to existing submission ${submissionId}`);
        }
        else {
            // Apply template text as initial content
            initialContent = assignRows[0].templateText || '';
            const [result] = await db_1.pool.query('INSERT INTO submissions (assignmentId, studentName, content, score, riskFlag, focusLostCount, status) VALUES (?, ?, ?, 100.0, "Green", 0, "Writing")', [assignmentId, studentName, initialContent]);
            submissionId = result.insertId;
            console.log(`Created new submission session ${submissionId} for ${studentName}`);
        }
        res.status(201).json({
            submissionId,
            assignment: assignRows[0],
            initialContent
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// GET submissions list for teacher dashboard (filtered by assignmentId)
router.get('/submissions', async (req, res) => {
    try {
        const assignmentId = req.query.assignmentId;
        let query = 'SELECT s.*, a.title as assignmentTitle, a.textLimit FROM submissions s JOIN assignments a ON s.assignmentId = a.id';
        let params = [];
        if (assignmentId) {
            query += ' WHERE s.assignmentId = ?';
            params.push(assignmentId);
        }
        query += ' ORDER BY s.submittedAt DESC, s.createdAt DESC';
        const [rows] = await db_1.pool.query(query, params);
        res.json(rows);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// GET specific submission details with full keystroke statistics
router.get('/submissions/:id', async (req, res) => {
    try {
        const [subRows] = await db_1.pool.query('SELECT s.*, a.title as assignmentTitle, a.templateText, a.textLimit, a.sensitivityMode FROM submissions s JOIN assignments a ON s.assignmentId = a.id WHERE s.id = ?', [req.params.id]);
        if (subRows.length === 0) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        const submission = subRows[0];
        const [keystrokes] = await db_1.pool.query('SELECT * FROM keystrokes WHERE submissionId = ? ORDER BY timestamp ASC', [req.params.id]);
        const [focusEvents] = await db_1.pool.query('SELECT * FROM focus_events WHERE submissionId = ? ORDER BY timestamp ASC', [req.params.id]);
        res.json({
            submission,
            keystrokes,
            focusEvents
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// POST ingest keystroke stream batch
router.post('/submissions/:id/keystrokes', async (req, res) => {
    const submissionId = Number(req.params.id);
    const { content, events } = req.body;
    try {
        // Verify status
        const [subRows] = await db_1.pool.query('SELECT status FROM submissions WHERE id = ?', [submissionId]);
        if (subRows.length === 0) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        if (subRows[0].status !== 'Writing') {
            return res.status(403).json({ error: 'Submission is locked/submitted' });
        }
        // Update current draft text
        if (content !== undefined) {
            await db_1.pool.query('UPDATE submissions SET content = ? WHERE id = ?', [content, submissionId]);
        }
        // Ingest keystrokes
        if (Array.isArray(events) && events.length > 0) {
            const sql = 'INSERT INTO keystrokes (submissionId, timestamp, eventType, keyChar, valueLength, position, textInserted, isVirtual) VALUES ?';
            const values = events.map(e => [
                submissionId,
                e.timestamp,
                e.eventType,
                e.keyChar || null,
                e.valueLength || 0,
                e.position || 0,
                e.textInserted || null,
                e.isVirtual ? 1 : 0
            ]);
            await db_1.pool.query(sql, [values]);
        }
        // Recalculate scoring & notify
        const updatedStats = await runSubmissionsAnalytics(submissionId);
        res.json({ success: true, stats: updatedStats });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// POST log focus transitions
router.post('/submissions/:id/focus', async (req, res) => {
    const submissionId = Number(req.params.id);
    const { eventType, timestamp } = req.body;
    try {
        if (!eventType || !timestamp) {
            return res.status(400).json({ error: 'eventType and timestamp are required' });
        }
        await db_1.pool.query('INSERT INTO focus_events (submissionId, eventType, timestamp) VALUES (?, ?, ?)', [
            submissionId,
            eventType,
            timestamp
        ]);
        // Recalculate
        const updatedStats = await runSubmissionsAnalytics(submissionId);
        res.json({ success: true, stats: updatedStats });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// POST submit assignment (normal submission)
router.post('/submissions/:id/submit', async (req, res) => {
    const submissionId = Number(req.params.id);
    try {
        const [subRows] = await db_1.pool.query('SELECT status FROM submissions WHERE id = ?', [submissionId]);
        if (subRows.length === 0) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        await db_1.pool.query('UPDATE submissions SET status = "Submitted", submittedAt = NOW() WHERE id = ?', [submissionId]);
        const updatedStats = await runSubmissionsAnalytics(submissionId);
        res.json({ success: true, stats: updatedStats });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// POST teacher force kill-switch
router.post('/submissions/:id/kill', async (req, res) => {
    const submissionId = Number(req.params.id);
    try {
        const [subRows] = await db_1.pool.query('SELECT status FROM submissions WHERE id = ?', [submissionId]);
        if (subRows.length === 0) {
            return res.status(404).json({ error: 'Submission not found' });
        }
        // Trigger websocket kill
        const wsKilled = (0, websocket_1.killStudentSession)(submissionId);
        // Update status to Forced
        await db_1.pool.query('UPDATE submissions SET status = "Forced", submittedAt = NOW() WHERE id = ?', [submissionId]);
        const updatedStats = await runSubmissionsAnalytics(submissionId);
        res.json({ success: true, wsKilled, stats: updatedStats });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// POST navigator.sendBeacon handler
// Receives beacon payload when tab closes.
// Beacon payloads are text/plain content-type, containing stringified JSON
router.post('/submissions/beacon', async (req, res) => {
    let payload;
    if (typeof req.body === 'string') {
        try {
            payload = JSON.parse(req.body);
        }
        catch {
            return res.status(400).json({ error: 'Invalid stringified body' });
        }
    }
    else {
        payload = req.body;
    }
    const { submissionId, content, events } = payload || {};
    if (!submissionId) {
        return res.status(400).json({ error: 'submissionId is required' });
    }
    try {
        // 1. Update text draft
        if (content !== undefined) {
            await db_1.pool.query('UPDATE submissions SET content = ? WHERE id = ?', [content, submissionId]);
        }
        // 2. Insert any trailing events
        if (Array.isArray(events) && events.length > 0) {
            const sql = 'INSERT INTO keystrokes (submissionId, timestamp, eventType, keyChar, valueLength, position, textInserted, isVirtual) VALUES ?';
            const values = events.map(e => [
                submissionId,
                e.timestamp,
                e.eventType,
                e.keyChar || null,
                e.valueLength || 0,
                e.position || 0,
                e.textInserted || null,
                e.isVirtual ? 1 : 0
            ]);
            await db_1.pool.query(sql, [values]);
        }
        // 3. Close the submission session if it is not already closed
        await db_1.pool.query('UPDATE submissions SET status = CASE WHEN status = "Writing" THEN "Submitted" ELSE status END, submittedAt = COALESCE(submittedAt, NOW()) WHERE id = ?', [submissionId]);
        // 4. Run final analytics
        const stats = await runSubmissionsAnalytics(submissionId);
        res.json({ success: true, stats });
    }
    catch (error) {
        console.error('Error saving sendBeacon payload:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;
