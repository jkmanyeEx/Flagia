import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../database';
import { authMiddleware, teacherOnly } from '../middleware/auth';
import { notifyAssignmentsUpdate } from '../websocket';

const router = Router();

// GET /api/assignments — list all (teacher sees own, student sees all)
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    let query: string;
    let params: any[];

    if (user.role === 'TEACHER') {
      query = `
        SELECT a.*,
          (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) as submission_count,
          u.name as teacher_name,
          c.name as classroom_name
        FROM assignments a
        JOIN users u ON a.teacher_id = u.id
        LEFT JOIN classrooms c ON a.classroom_id = c.id
        WHERE a.teacher_id = ?
        ORDER BY a.created_at DESC
      `;
      params = [user.userId];
    } else {
      // Students see: standalone assignments they directly joined (have a
      // submission for), plus every assignment in a classroom they belong to.
      query = `
        SELECT a.*,
          u.name as teacher_name,
          c.name as classroom_name,
          sub.id as my_submission_id,
          sub.status as my_status
        FROM assignments a
        JOIN users u ON a.teacher_id = u.id
        LEFT JOIN classrooms c ON a.classroom_id = c.id
        LEFT JOIN submissions sub ON sub.assignment_id = a.id AND sub.student_id = ?
        WHERE (a.classroom_id IS NULL AND sub.id IS NOT NULL)
           OR a.classroom_id IN (
             SELECT classroom_id FROM classroom_members WHERE student_id = ?
           )
        ORDER BY a.due_date ASC
      `;
      params = [user.userId, user.userId];
    }

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('List assignments error:', err);
    res.status(500).json({ error: '과제 목록을 불러올 수 없습니다' });
  }
});

// GET /api/assignments/my-submissions — list student's submissions
router.get('/my-submissions', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'STUDENT') {
      res.status(403).json({ error: '학생만 접근할 수 있습니다' });
      return;
    }
    const [rows] = await pool.query(
      'SELECT * FROM submissions WHERE student_id = ?',
      [user.userId]
    );
    res.json(rows);
  } catch (err) {
    console.error('List my submissions error:', err);
    res.status(500).json({ error: '제출 목록을 불러올 수 없습니다' });
  }
});

// GET /api/assignments/join/:code - lookup by join code
router.get('/join/:code', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const [rows] = await pool.query(
      `SELECT a.id, a.title, a.due_date, u.name as teacher_name 
       FROM assignments a JOIN users u ON a.teacher_id = u.id 
       WHERE a.join_code = ?`,
      [code.toUpperCase()]
    );
    const assignments = rows as any[];
    if (assignments.length === 0) {
      res.status(404).json({ error: '유효하지 않은 참여 코드입니다' });
      return;
    }
    res.json(assignments[0]);
  } catch (err) {
    console.error('Lookup assignment error:', err);
    res.status(500).json({ error: '과제를 찾을 수 없습니다' });
  }
});

// POST /api/assignments/join/:code - student joins assignment
router.post('/join/:code', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'STUDENT') {
      res.status(403).json({ error: '학생만 과제에 참여할 수 있습니다' });
      return;
    }

    const { code } = req.params;
    const [assignmentRows] = await pool.query(
      `SELECT id FROM assignments WHERE join_code = ?`,
      [code.toUpperCase()]
    );
    const assignments = assignmentRows as any[];
    if (assignments.length === 0) {
      res.status(404).json({ error: '유효하지 않은 참여 코드입니다' });
      return;
    }

    const assignmentId = assignments[0].id;

    // Check if already joined
    const [existing] = await pool.query(
      `SELECT id FROM submissions WHERE assignment_id = ? AND student_id = ?`,
      [assignmentId, user.userId]
    );
    if ((existing as any[]).length > 0) {
      res.status(400).json({ error: '이미 참여한 과제입니다' });
      return;
    }

    // Register the student to the assignment WITHOUT marking them as writing.
    // Status stays ASSIGNED until they actually open the editor.
    const submissionId = uuidv4();
    await pool.query(
      `INSERT INTO submissions (id, assignment_id, student_id, final_markdown, status) VALUES (?, ?, ?, ?, ?)`,
      [submissionId, assignmentId, user.userId, '', 'ASSIGNED']
    );

    res.json({ message: '과제에 참여했습니다', assignmentId, submissionId });
  } catch (err) {
    console.error('Join assignment error:', err);
    res.status(500).json({ error: '과제 참여 중 오류가 발생했습니다' });
  }
});

// GET /api/assignments/:id
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.*, u.name as teacher_name 
       FROM assignments a JOIN users u ON a.teacher_id = u.id 
       WHERE a.id = ?`,
      [req.params.id]
    );
    const assignments = rows as any[];
    if (assignments.length === 0) {
      res.status(404).json({ error: '과제를 찾을 수 없습니다' });
      return;
    }
    res.json(assignments[0]);
  } catch (err) {
    console.error('Get assignment error:', err);
    res.status(500).json({ error: '과제를 불러올 수 없습니다' });
  }
});

// POST /api/assignments — create (teacher only)
router.post('/', authMiddleware, teacherOnly, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { title, dueDate, timeLimit, textLimit, maxScore, templateText, mode, classroomId } = req.body;

    if (!title || !dueDate || !timeLimit) {
      res.status(400).json({ error: '필수 항목을 모두 입력해 주세요' });
      return;
    }

    // If targeting a classroom, the teacher must own it.
    if (classroomId) {
      const [cRows] = await pool.query(
        'SELECT teacher_id FROM classrooms WHERE id = ?',
        [classroomId]
      );
      const classroom = (cRows as any[])[0];
      if (!classroom) {
        res.status(404).json({ error: '학급을 찾을 수 없습니다' });
        return;
      }
      if (classroom.teacher_id !== user.userId) {
        res.status(403).json({ error: '본인 소유의 학급에만 과제를 만들 수 있습니다' });
        return;
      }
    }

    const id = uuidv4();
    const joinCode = uuidv4().replace(/-/g, '').substring(0, 6).toUpperCase();
    await pool.query(
      `INSERT INTO assignments (id, teacher_id, classroom_id, title, due_date, time_limit, text_limit, max_score, template_text, mode, join_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, user.userId, classroomId || null, title, new Date(dueDate), timeLimit || 60, textLimit || 3000, maxScore || 100, templateText || '', mode || 'STANDARD', joinCode]
    );

    const [rows] = await pool.query(
      `SELECT a.*, 
         0 as submission_count,
         u.name as teacher_name
       FROM assignments a
       JOIN users u ON a.teacher_id = u.id
       WHERE a.id = ?`,
      [id]
    );
    const newAssignment = (rows as any[])[0];

    notifyAssignmentsUpdate();
    res.status(201).json(newAssignment);
  } catch (err) {
    console.error('Create assignment error:', err);
    res.status(500).json({ error: '과제를 생성할 수 없습니다' });
  }
});

// GET /api/assignments/:id/submissions — teacher view submissions with scores
router.get('/:id/submissions', authMiddleware, teacherOnly, async (req: Request, res: Response) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.*, u.name as student_name, u.email as student_email
       FROM submissions s
       JOIN users u ON s.student_id = u.id
       WHERE s.assignment_id = ?
       ORDER BY s.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('List submissions error:', err);
    res.status(500).json({ error: '제출물 목록을 불러올 수 없습니다' });
  }
});

// DELETE /api/assignments/:id
router.delete('/:id', authMiddleware, teacherOnly, async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM assignments WHERE id = ? AND teacher_id = ?', [
      req.params.id,
      (req as any).user.userId,
    ]);
    notifyAssignmentsUpdate();
    res.json({ message: '과제가 삭제되었습니다' });
  } catch (err) {
    console.error('Delete assignment error:', err);
    res.status(500).json({ error: '과제를 삭제할 수 없습니다' });
  }
});

export default router;
