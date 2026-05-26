"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const database_1 = __importDefault(require("../database"));
const auth_1 = require("../middleware/auth");
const websocket_1 = require("../websocket");
const router = (0, express_1.Router)();
function genCode() {
    return (0, uuid_1.v4)().replace(/-/g, '').substring(0, 6).toUpperCase();
}
// GET /api/classrooms — teacher: own classrooms; student: joined classrooms
router.get('/', auth_1.authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        if (user.role === 'TEACHER') {
            const [rows] = await database_1.default.query(`SELECT c.*,
            (SELECT COUNT(*) FROM classroom_members m WHERE m.classroom_id = c.id) AS member_count,
            (SELECT COUNT(*) FROM assignments a WHERE a.classroom_id = c.id) AS assignment_count
         FROM classrooms c
         WHERE c.teacher_id = ?
         ORDER BY c.created_at DESC`, [user.userId]);
            res.json(rows);
        }
        else if (user.role === 'ADMIN') {
            // Admin oversight: every classroom. teacher_id (via c.*) tells the client
            // which ones the admin owns; is_member flags ones they joined. Actions are
            // limited to owned/joined on both client and server.
            const [rows] = await database_1.default.query(`SELECT c.*, u.name AS teacher_name,
            (SELECT COUNT(*) FROM classroom_members m WHERE m.classroom_id = c.id) AS member_count,
            (SELECT COUNT(*) FROM assignments a WHERE a.classroom_id = c.id) AS assignment_count,
            (SELECT COUNT(*) FROM classroom_members m2 WHERE m2.classroom_id = c.id AND m2.student_id = ?) AS is_member
         FROM classrooms c
         JOIN users u ON c.teacher_id = u.id
         ORDER BY c.created_at DESC`, [user.userId]);
            res.json(rows);
        }
        else {
            const [rows] = await database_1.default.query(`SELECT c.*, u.name AS teacher_name,
            (SELECT COUNT(*) FROM classroom_members m WHERE m.classroom_id = c.id) AS member_count,
            (SELECT COUNT(*) FROM assignments a WHERE a.classroom_id = c.id) AS assignment_count
         FROM classrooms c
         JOIN classroom_members cm ON cm.classroom_id = c.id AND cm.student_id = ?
         JOIN users u ON c.teacher_id = u.id
         ORDER BY c.created_at DESC`, [user.userId]);
            res.json(rows);
        }
    }
    catch (err) {
        console.error('List classrooms error:', err);
        res.status(500).json({ error: '학급 목록을 불러올 수 없습니다' });
    }
});
// POST /api/classrooms — create (teacher)
router.post('/', auth_1.authMiddleware, auth_1.teacherOnly, async (req, res) => {
    try {
        const user = req.user;
        const { name, description } = req.body;
        if (!name || !String(name).trim()) {
            res.status(400).json({ error: '학급 이름을 입력해 주세요' });
            return;
        }
        // Generate a unique join code (retry on the rare collision)
        let joinCode = genCode();
        for (let i = 0; i < 5; i++) {
            const [dup] = await database_1.default.query('SELECT id FROM classrooms WHERE join_code = ?', [joinCode]);
            if (dup.length === 0)
                break;
            joinCode = genCode();
        }
        const id = (0, uuid_1.v4)();
        await database_1.default.query(`INSERT INTO classrooms (id, teacher_id, name, description, join_code)
       VALUES (?, ?, ?, ?, ?)`, [id, user.userId, String(name).trim(), description || null, joinCode]);
        const [rows] = await database_1.default.query(`SELECT c.*, 0 AS member_count, 0 AS assignment_count FROM classrooms c WHERE c.id = ?`, [id]);
        res.status(201).json(rows[0]);
    }
    catch (err) {
        console.error('Create classroom error:', err);
        res.status(500).json({ error: '학급을 생성할 수 없습니다' });
    }
});
// POST /api/classrooms/join/:code — student joins by code (idempotent)
router.post('/join/:code', auth_1.authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        if (user.role !== 'STUDENT' && user.role !== 'ADMIN') {
            res.status(403).json({ error: '학생만 학급에 참여할 수 있습니다' });
            return;
        }
        const code = String(req.params.code || '').toUpperCase();
        const [rows] = await database_1.default.query('SELECT id FROM classrooms WHERE join_code = ?', [code]);
        const classrooms = rows;
        if (classrooms.length === 0) {
            res.status(404).json({ error: '유효하지 않은 참여 코드입니다' });
            return;
        }
        const classroomId = classrooms[0].id;
        const [existing] = await database_1.default.query('SELECT id FROM classroom_members WHERE classroom_id = ? AND student_id = ?', [classroomId, user.userId]);
        if (existing.length === 0) {
            await database_1.default.query('INSERT INTO classroom_members (id, classroom_id, student_id) VALUES (?, ?, ?)', [(0, uuid_1.v4)(), classroomId, user.userId]);
            (0, websocket_1.notifyClassroomMembersUpdate)(classroomId);
        }
        res.json({ message: '학급에 참여했습니다', classroomId });
    }
    catch (err) {
        console.error('Join classroom error:', err);
        res.status(500).json({ error: '학급 참여 중 오류가 발생했습니다' });
    }
});
// DELETE /api/classrooms/:id/leave — student/admin leaves a joined classroom
router.delete('/:id/leave', auth_1.authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        if (user.role !== 'STUDENT' && user.role !== 'ADMIN') {
            res.status(403).json({ error: '학생만 학급을 탈퇴할 수 있습니다' });
            return;
        }
        const [result] = await database_1.default.query('DELETE FROM classroom_members WHERE classroom_id = ? AND student_id = ?', [req.params.id, user.userId]);
        if (result.affectedRows === 0) {
            res.status(404).json({ error: '해당 학급에 참여하고 있지 않습니다' });
            return;
        }
        (0, websocket_1.notifyClassroomMembersUpdate)(req.params.id);
        res.json({ message: '학급에서 탈퇴했습니다' });
    }
    catch (err) {
        console.error('Leave classroom error:', err);
        res.status(500).json({ error: '학급 탈퇴 중 오류가 발생했습니다' });
    }
});
// GET /api/classrooms/:id — detail (owner teacher or member) + members + assignments
router.get('/:id', auth_1.authMiddleware, async (req, res) => {
    try {
        const user = req.user;
        const [rows] = await database_1.default.query(`SELECT c.*, u.name AS teacher_name FROM classrooms c
       JOIN users u ON c.teacher_id = u.id WHERE c.id = ?`, [req.params.id]);
        const classroom = rows[0];
        if (!classroom) {
            res.status(404).json({ error: '학급을 찾을 수 없습니다' });
            return;
        }
        // Access level (viewMode) vs. actual relationship (relation):
        //   viewMode  OWNER       — full management. Admins get this for EVERY classroom.
        //             PARTICIPANT — an enrolled member → can write
        //             VIEWER      — read-only (non-admin, non-owner, non-member)
        //   relation  OWNER / MEMBER / NONE — what the user actually is, for display.
        const [m] = await database_1.default.query('SELECT id FROM classroom_members WHERE classroom_id = ? AND student_id = ?', [req.params.id, user.userId]);
        const isMember = m.length > 0;
        const isOwner = (user.role === 'TEACHER' || user.role === 'ADMIN') && classroom.teacher_id === user.userId;
        const isAdmin = user.role === 'ADMIN';
        if (!isOwner && !isMember && !isAdmin) {
            res.status(403).json({ error: '접근 권한이 없습니다' });
            return;
        }
        // Admins manage everything. Their actual relationship is reported separately
        // so the client can show a "not created/invited" marker.
        const viewMode = (isOwner || isAdmin) ? 'OWNER' : (isMember ? 'PARTICIPANT' : 'VIEWER');
        const relation = isOwner ? 'OWNER' : (isMember ? 'MEMBER' : 'NONE');
        // Roster is exposed to anyone with OWNER-level access (owner or admin).
        let members = [];
        if (viewMode === 'OWNER') {
            const [mRows] = await database_1.default.query(`SELECT u.id, u.name, u.email, cm.joined_at
         FROM classroom_members cm JOIN users u ON cm.student_id = u.id
         WHERE cm.classroom_id = ? ORDER BY cm.joined_at ASC`, [req.params.id]);
            members = mRows;
        }
        // OWNER and VIEWER get the oversight list (submission counts); PARTICIPANT
        // gets their own per-assignment submission status so they can write.
        let assignments;
        if (viewMode === 'PARTICIPANT') {
            const [aRows] = await database_1.default.query(`SELECT a.*, sub.id AS my_submission_id, sub.status AS my_status
         FROM assignments a
         LEFT JOIN submissions sub ON sub.assignment_id = a.id AND sub.student_id = ?
         WHERE a.classroom_id = ? ORDER BY a.due_date ASC`, [user.userId, req.params.id]);
            assignments = aRows;
        }
        else {
            const [aRows] = await database_1.default.query(`SELECT a.*,
            (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) AS submission_count
         FROM assignments a WHERE a.classroom_id = ? ORDER BY a.created_at DESC`, [req.params.id]);
            assignments = aRows;
        }
        res.json({ classroom, members, assignments, viewMode, relation });
    }
    catch (err) {
        console.error('Get classroom error:', err);
        res.status(500).json({ error: '학급 정보를 불러올 수 없습니다' });
    }
});
// PATCH /api/classrooms/:id — rename / toggle publicity (owner teacher)
router.patch('/:id', auth_1.authMiddleware, auth_1.teacherOnly, async (req, res) => {
    try {
        const user = req.user;
        const { name, description } = req.body;
        const [rows] = await database_1.default.query('SELECT teacher_id FROM classrooms WHERE id = ?', [req.params.id]);
        const classroom = rows[0];
        if (!classroom) {
            res.status(404).json({ error: '학급을 찾을 수 없습니다' });
            return;
        }
        if (classroom.teacher_id !== user.userId && user.role !== 'ADMIN') {
            res.status(403).json({ error: '접근 권한이 없습니다' });
            return;
        }
        const fields = [];
        const params = [];
        if (typeof name === 'string' && name.trim()) {
            fields.push('name = ?');
            params.push(name.trim());
        }
        if (description !== undefined) {
            fields.push('description = ?');
            params.push(description || null);
        }
        if (fields.length === 0) {
            res.status(400).json({ error: '변경할 항목이 없습니다' });
            return;
        }
        params.push(req.params.id);
        await database_1.default.query(`UPDATE classrooms SET ${fields.join(', ')} WHERE id = ?`, params);
        const [updated] = await database_1.default.query('SELECT * FROM classrooms WHERE id = ?', [req.params.id]);
        res.json(updated[0]);
    }
    catch (err) {
        console.error('Update classroom error:', err);
        res.status(500).json({ error: '학급을 수정할 수 없습니다' });
    }
});
// DELETE /api/classrooms/:id — owner teacher (cascades assignments + members)
router.delete('/:id', auth_1.authMiddleware, auth_1.teacherOnly, async (req, res) => {
    try {
        const user = req.user;
        // Admins may delete any classroom; teachers only their own.
        const [result] = user.role === 'ADMIN'
            ? await database_1.default.query('DELETE FROM classrooms WHERE id = ?', [req.params.id])
            : await database_1.default.query('DELETE FROM classrooms WHERE id = ? AND teacher_id = ?', [req.params.id, user.userId]);
        if (result.affectedRows === 0) {
            res.status(404).json({ error: '학급을 찾을 수 없거나 권한이 없습니다' });
            return;
        }
        (0, websocket_1.notifyAssignmentsUpdate)();
        res.json({ message: '학급이 삭제되었습니다' });
    }
    catch (err) {
        console.error('Delete classroom error:', err);
        res.status(500).json({ error: '학급을 삭제할 수 없습니다' });
    }
});
exports.default = router;
//# sourceMappingURL=classrooms.js.map