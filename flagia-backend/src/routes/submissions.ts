import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../database';
import { authMiddleware, teacherOnly } from '../middleware/auth';
import { runFlagiaAnalysis } from '../engine/flagiaEngine';
import { notifySubmissionsUpdate } from '../websocket';

const router = Router();

// POST /api/submissions — create or get existing submission for student+assignment
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { assignmentId } = req.body;

    if (!assignmentId) {
      res.status(400).json({ error: '과제 ID가 필요합니다' });
      return;
    }

    // Check if submission already exists
    const [existing] = await pool.query(
      'SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?',
      [assignmentId, user.userId]
    );
    const submissions = existing as any[];

    if (submissions.length > 0) {
      const sub = submissions[0];
      // Opening the editor on an ASSIGNED submission means writing has begun.
      if (sub.status === 'ASSIGNED') {
        await pool.query(
          `UPDATE submissions SET status = 'IN_PROGRESS' WHERE id = ? AND status = 'ASSIGNED'`,
          [sub.id]
        );
        sub.status = 'IN_PROGRESS';
        notifySubmissionsUpdate(assignmentId, user.userId);
      }
      res.json(sub);
      return;
    }

    // Authorization for classroom assignments: the student must be a member.
    // Standalone assignments (classroom_id NULL) keep the legacy open behavior.
    const [aRows] = await pool.query(
      'SELECT classroom_id FROM assignments WHERE id = ?',
      [assignmentId]
    );
    const assignment = (aRows as any[])[0];
    if (!assignment) {
      res.status(404).json({ error: '과제를 찾을 수 없습니다' });
      return;
    }
    if (assignment.classroom_id) {
      const [m] = await pool.query(
        'SELECT id FROM classroom_members WHERE classroom_id = ? AND student_id = ?',
        [assignment.classroom_id, user.userId]
      );
      if ((m as any[]).length === 0) {
        res.status(403).json({ error: '학급에 참여한 학생만 과제를 시작할 수 있습니다' });
        return;
      }
    }

    // Create new submission
    const id = uuidv4();
    await pool.query(
      `INSERT INTO submissions (id, assignment_id, student_id, status)
       VALUES (?, ?, ?, 'IN_PROGRESS')`,
      [id, assignmentId, user.userId]
    );

    const [newSub] = await pool.query('SELECT * FROM submissions WHERE id = ?', [id]);
    notifySubmissionsUpdate(assignmentId, user.userId);
    res.status(201).json((newSub as any[])[0]);
  } catch (err) {
    console.error('Create submission error:', err);
    res.status(500).json({ error: '제출물을 생성할 수 없습니다' });
  }
});

// PUT /api/submissions/:id/submit — finalize submission and trigger analysis
router.put('/:id/submit', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { finalMarkdown, forceClose } = req.body;
    const status = forceClose ? 'FORCE_CLOSED' : 'SUBMITTED';

    // Update the submission text and status
    await pool.query(
      `UPDATE submissions SET final_markdown = ?, status = ?, submitted_at = NOW()
       WHERE id = ? AND status = 'IN_PROGRESS'`,
      [finalMarkdown || '', status, req.params.id]
    );

    // Get submission with assignment info for analysis
    const [rows] = await pool.query(
      `SELECT s.*, a.template_text, a.mode, a.text_limit
       FROM submissions s
       JOIN assignments a ON s.assignment_id = a.id
       WHERE s.id = ?`,
      [req.params.id]
    );
    const submission = (rows as any[])[0];
    if (!submission) {
      res.status(404).json({ error: '제출물을 찾을 수 없습니다' });
      return;
    }

    // Gather all session events for analysis
    const [sessionRows] = await pool.query(
      'SELECT events_blob FROM sessions WHERE submission_id = ? ORDER BY start_time ASC',
      [req.params.id]
    );
    const allEvents: any[] = [];
    for (const session of sessionRows as any[]) {
      if (session.events_blob) {
        try {
          const parsed = JSON.parse(session.events_blob);
          if (Array.isArray(parsed)) allEvents.push(...parsed);
        } catch { /* skip malformed blob */ }
      }
    }

    // Run Flagia analysis engine safely
    let analysis;
    try {
      analysis = runFlagiaAnalysis(
        allEvents,
        submission.final_markdown || '',
        submission.template_text || '',
        submission.mode
      );

      // Update submission with analysis results + cache full analysis JSON
      await pool.query(
        `UPDATE submissions SET
          flagia_score = ?, flag_status = ?,
          coefficient_of_variation = ?, revision_ratio = ?,
          total_paste_count = ?, total_blur_duration = ?,
          analysis_json = ?
         WHERE id = ?`,
        [
          analysis.flagiaScore,
          analysis.flagStatus,
          analysis.coefficientOfVariation,
          analysis.revisionRatio,
          analysis.totalPasteCount,
          analysis.totalBlurDuration,
          JSON.stringify(analysis),
          req.params.id,
        ]
      );
    } catch (engineErr) {
      console.error('Flagia Analysis Engine Error:', engineErr);
      // Even if analysis fails, we don't revert the submission status.
      // The student has successfully submitted.
    }

    notifySubmissionsUpdate(submission.assignment_id, submission.student_id);
    res.json({ message: '제출 완료', analysis: analysis || null });
  } catch (err) {
    console.error('Submit error:', err);
    res.status(500).json({ error: '제출 처리 중 오류가 발생했습니다' });
  }
});

// PUT /api/submissions/:id/draft — periodic auto-save of in-progress work.
// Persists the latest markdown and the cumulative active writing time so the
// countdown timer can resume (rather than reset) when the student reopens the
// editor. time_spent_sec is clamped monotonically (GREATEST) and capped at the
// assignment's time budget, so it can never be rolled back to gain extra time.
router.put('/:id/draft', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { markdown, timeSpentSec } = req.body;
    const safeSpent = Math.max(0, Math.floor(Number(timeSpentSec) || 0));

    await pool.query(
      `UPDATE submissions s
       JOIN assignments a ON s.assignment_id = a.id
       SET s.final_markdown = COALESCE(?, s.final_markdown),
           s.time_spent_sec = LEAST(a.time_limit * 60, GREATEST(s.time_spent_sec, ?))
       WHERE s.id = ? AND s.status = 'IN_PROGRESS'`,
      [markdown ?? null, safeSpent, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Draft save error:', err);
    res.status(500).json({ error: '임시 저장에 실패했습니다' });
  }
});

// GET /api/submissions/:id/analysis — detailed analysis data
router.get('/:id/analysis', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    // Get submission with student/assignment info
    const [rows] = await pool.query(
      `SELECT s.*, a.title as assignment_title, a.template_text, a.mode, a.text_limit,
              a.time_limit, a.max_score, u.name as student_name, u.email as student_email
       FROM submissions s
       JOIN assignments a ON s.assignment_id = a.id
       JOIN users u ON s.student_id = u.id
       WHERE s.id = ?`,
      [req.params.id]
    );
    const submission = (rows as any[])[0];
    
    if (!submission) {
      res.status(404).json({ error: '제출물을 찾을 수 없습니다' });
      return;
    }

    // Permission check: teacher can view any, student can view own only
    if (user.role === 'STUDENT' && submission.student_id !== user.userId) {
      res.status(403).json({ error: '접근 권한이 없습니다' });
      return;
    }

    // If cached analysis exists, return it
    if (submission.analysis_json) {
      try {
        const cached = JSON.parse(submission.analysis_json);
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
          analysis: cached,
        });
        return;
      } catch { /* recompute */ }
    }

    // Recompute analysis if not cached
    const [sessionRows] = await pool.query(
      `SELECT id, start_time, end_time, ip_address, user_agent, events_blob
       FROM sessions WHERE submission_id = ? ORDER BY start_time ASC`,
      [req.params.id]
    );
    const allEvents: any[] = [];
    const sessions = sessionRows as any[];
    for (const session of sessions) {
      if (session.events_blob) {
        try {
          const parsed = JSON.parse(session.events_blob);
          if (Array.isArray(parsed)) allEvents.push(...parsed);
        } catch { /* skip */ }
      }
    }

    const analysis = runFlagiaAnalysis(
      allEvents,
      submission.final_markdown || '',
      submission.template_text || '',
      submission.mode
    );

    // Update session count in summary
    analysis.sessionSummary.sessionCount = sessions.length;

    // Cache it
    await pool.query(
      'UPDATE submissions SET analysis_json = ? WHERE id = ?',
      [JSON.stringify(analysis), req.params.id]
    );

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
      analysis,
    });
  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({ error: '분석 데이터를 불러올 수 없습니다' });
  }
});

// GET /api/submissions/:id/events — raw events list for replay
router.get('/:id/events', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;

    // Get submission
    const [rows] = await pool.query(
      'SELECT student_id FROM submissions WHERE id = ?',
      [req.params.id]
    );
    const submission = (rows as any[])[0];

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
    const [sessionRows] = await pool.query(
      'SELECT events_blob FROM sessions WHERE submission_id = ? ORDER BY start_time ASC',
      [req.params.id]
    );
    const allEvents: any[] = [];
    const sessions = sessionRows as any[];
    for (const session of sessions) {
      if (session.events_blob) {
        try {
          const parsed = JSON.parse(session.events_blob);
          if (Array.isArray(parsed)) allEvents.push(...parsed);
        } catch { /* skip */ }
      }
    }

    res.json({ events: allEvents });
  } catch (err) {
    console.error('Fetch events error:', err);
    res.status(500).json({ error: '이벤트를 불러올 수 없습니다' });
  }
});


// POST /api/submissions/:id/beacon — fired on window close via sendBeacon.
// Every assignment is resumable, so this never submits: it just persists the
// latest draft and leaves the submission IN_PROGRESS. The actual "left the
// site" timestamp is recorded server-side as a `leave` event when the
// WebSocket disconnects (see websocket.ts).
router.post('/:id/beacon', async (req: Request, res: Response) => {
  try {
    const { finalMarkdown, timeSpentSec } = req.body;
    const safeSpent = Math.max(0, Math.floor(Number(timeSpentSec) || 0));

    await pool.query(
      `UPDATE submissions s
       JOIN assignments a ON s.assignment_id = a.id
       SET s.final_markdown = ?,
           s.time_spent_sec = LEAST(a.time_limit * 60, GREATEST(s.time_spent_sec, ?))
       WHERE s.id = ? AND s.status = 'IN_PROGRESS'`,
      [finalMarkdown || '', safeSpent, req.params.id]
    );

    const [subRows] = await pool.query('SELECT assignment_id, student_id FROM submissions WHERE id = ?', [req.params.id]);
    const sub = (subRows as any[])[0];
    if (sub) {
      notifySubmissionsUpdate(sub.assignment_id, sub.student_id);
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Beacon submit error:', err);
    res.status(500).json({ error: 'Beacon submit failed' });
  }
});

// POST /api/submissions/:id/events — REST fallback for event batch ingest
router.post('/:id/events', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { sessionId, events } = req.body;
    if (!sessionId || !events) {
      res.status(400).json({ error: 'sessionId와 events가 필요합니다' });
      return;
    }

    // Append events to session blob
    const [rows] = await pool.query('SELECT events_blob FROM sessions WHERE id = ?', [sessionId]);
    const session = (rows as any[])[0];
    if (!session) {
      res.status(404).json({ error: '세션을 찾을 수 없습니다' });
      return;
    }

    let existingEvents: any[] = [];
    if (session.events_blob) {
      try {
        existingEvents = JSON.parse(session.events_blob);
      } catch { /* reset if malformed */ }
    }

    existingEvents.push(...events);
    await pool.query('UPDATE sessions SET events_blob = ? WHERE id = ?', [
      JSON.stringify(existingEvents),
      sessionId,
    ]);

    res.json({ received: events.length, total: existingEvents.length });
  } catch (err) {
    console.error('Event ingest error:', err);
    res.status(500).json({ error: '이벤트 저장 실패' });
  }
});

// POST /api/submissions/:id/grade — grade a submission (teacher only)
router.post('/:id/grade', authMiddleware, teacherOnly, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { score, feedback } = req.body;

    // Only the owning teacher (or owning admin) may grade.
    const [ownerRows] = await pool.query(
      `SELECT a.teacher_id FROM submissions s JOIN assignments a ON s.assignment_id = a.id WHERE s.id = ?`,
      [req.params.id]
    );
    const owner = (ownerRows as any[])[0];
    if (!owner) {
      res.status(404).json({ error: '제출물을 찾을 수 없습니다' });
      return;
    }
    if (owner.teacher_id !== user.userId) {
      res.status(403).json({ error: '본인이 만든 과제의 제출물만 채점할 수 있습니다' });
      return;
    }

    await pool.query(
      'UPDATE submissions SET score = ?, feedback = ? WHERE id = ?',
      [score !== undefined && score !== null ? score : null, feedback || null, req.params.id]
    );

    // Also update cached analysis_json if it exists to keep everything in sync
    const [subRows] = await pool.query('SELECT assignment_id, student_id FROM submissions WHERE id = ?', [req.params.id]);
    const sub = (subRows as any[])[0];
    if (sub) {
      notifySubmissionsUpdate(sub.assignment_id, sub.student_id);
    }

    res.json({ message: '성공적으로 채점되었습니다', score, feedback });
  } catch (err) {
    console.error('Grade submission error:', err);
    res.status(500).json({ error: '채점 정보를 저장할 수 없습니다' });
  }
});

export default router;
