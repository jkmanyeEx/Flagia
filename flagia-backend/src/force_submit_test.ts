/**
 * Live integration test for assignment-wide force submission.
 *
 * Prerequisite: run the API on TEST_API_URL (default http://localhost:3000)
 * against a disposable development database, then:
 *   npm run test:force-submit
 *
 * Optional: TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD also verifies that an
 * existing administrator can execute the action on another teacher's task.
 */
import WebSocket from 'ws';

const API_URL = process.env.TEST_API_URL || 'http://localhost:3000';
const WS_URL = process.env.TEST_WS_URL || API_URL.replace(/^http/, 'ws') + '/ws';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function jsonRequest(path: string, options: RequestInit = {}, token?: string) {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path}: ${response.status} ${JSON.stringify(body)}`);
  }
  return body as any;
}

async function register(role: 'TEACHER' | 'STUDENT', label: string, stamp: number) {
  return jsonRequest('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: label,
      email: `${label.toLowerCase().replace(/\s/g, '-')}-${stamp}@force-submit.test`,
      password: 'password123!',
      role,
    }),
  });
}

class SocketInbox {
  readonly ws: WebSocket;
  private messages: any[] = [];
  private waiters: Array<{ predicate: (message: any) => boolean; resolve: (message: any) => void }> = [];

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', raw => {
      const message = JSON.parse(raw.toString());
      const waiterIndex = this.waiters.findIndex(waiter => waiter.predicate(message));
      if (waiterIndex >= 0) {
        const [waiter] = this.waiters.splice(waiterIndex, 1);
        waiter.resolve(message);
      } else {
        this.messages.push(message);
      }
    });
  }

  static async connect(token: string) {
    const ws = new WebSocket(WS_URL);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const inbox = new SocketInbox(ws);
    ws.send(JSON.stringify({ type: 'auth', payload: { token } }));
    await inbox.waitFor(message => message.type === 'auth_ok');
    return inbox;
  }

  waitFor(predicate: (message: any) => boolean, timeoutMs = 10_000): Promise<any> {
    const index = this.messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        const current = this.waiters.indexOf(waiter);
        if (current >= 0) this.waiters.splice(current, 1);
        reject(new Error('WebSocket 응답 대기 시간이 초과되었습니다'));
      }, timeoutMs);
    });
  }

  close() {
    this.ws.close();
  }
}

async function requestForceSubmit(inbox: SocketInbox, assignmentId: string, prefix: string) {
  const requestId = `${prefix}-${Date.now()}-${Math.random()}`;
  inbox.ws.send(JSON.stringify({ type: 'force_submit', payload: { assignmentId, requestId } }));
  return inbox.waitFor(
    message =>
      (message.type === 'force_submit_ack' || message.type === 'force_submit_error') &&
      message.payload?.requestId === requestId,
    15_000
  );
}

async function run() {
  const stamp = Date.now();
  const sockets: SocketInbox[] = [];
  let assignmentId: string | null = null;
  let ownerToken = '';

  try {
    const [owner, otherTeacher, onlineStudent, offlineStudent, submittedStudent] = await Promise.all([
      register('TEACHER', 'Force Owner', stamp),
      register('TEACHER', 'Force Other', stamp),
      register('STUDENT', 'Force Online', stamp),
      register('STUDENT', 'Force Offline', stamp),
      register('STUDENT', 'Force Submitted', stamp),
    ]);
    ownerToken = owner.token;

    const assignment = await jsonRequest('/api/assignments', {
      method: 'POST',
      body: JSON.stringify({
        title: `작성 일괄 종료 통합 테스트 ${stamp}`,
        dueDate: new Date(Date.now() + 86_400_000).toISOString(),
        timeLimit: 60,
        textLimit: 3000,
        maxScore: 100,
        templateText: '통합 테스트 템플릿',
        mode: 'STANDARD',
      }),
    }, ownerToken);
    assignmentId = assignment.id;
    const activeAssignmentId = String(assignment.id);

    const [onlineSub, offlineSub, alreadySub] = await Promise.all([
      jsonRequest('/api/submissions', {
        method: 'POST',
        body: JSON.stringify({ assignmentId: activeAssignmentId }),
      }, onlineStudent.token),
      jsonRequest('/api/submissions', {
        method: 'POST',
        body: JSON.stringify({ assignmentId: activeAssignmentId }),
      }, offlineStudent.token),
      jsonRequest('/api/submissions', {
        method: 'POST',
        body: JSON.stringify({ assignmentId: activeAssignmentId }),
      }, submittedStudent.token),
    ]);

    await jsonRequest(`/api/submissions/${onlineSub.id}/draft`, {
      method: 'PUT',
      body: JSON.stringify({ markdown: '접속 학생의 이전 저장본', timeSpentSec: 10 }),
    }, onlineStudent.token);
    await jsonRequest(`/api/submissions/${offlineSub.id}/draft`, {
      method: 'PUT',
      body: JSON.stringify({ markdown: '미접속 학생의 최신 저장 초안', timeSpentSec: 20 }),
    }, offlineStudent.token);
    await jsonRequest(`/api/submissions/${alreadySub.id}/submit`, {
      method: 'PUT',
      body: JSON.stringify({ finalMarkdown: '이미 제출한 학생의 원문', forceClose: false }),
    }, submittedStudent.token);

    const before = await jsonRequest(`/api/assignments/${activeAssignmentId}/submissions`, {}, ownerToken);
    const alreadyBefore = before.find((item: any) => item.id === alreadySub.id);

    const ownerSocket = await SocketInbox.connect(ownerToken);
    const otherSocket = await SocketInbox.connect(otherTeacher.token);
    const onlineSocket = await SocketInbox.connect(onlineStudent.token);
    sockets.push(ownerSocket, otherSocket, onlineSocket);

    onlineSocket.ws.send(JSON.stringify({
      type: 'join_session',
      payload: { submissionId: onlineSub.id, assignmentId: activeAssignmentId },
    }));
    await onlineSocket.waitFor(message => message.type === 'session_ready');

    const unauthorized = await requestForceSubmit(otherSocket, activeAssignmentId, 'unauthorized');
    assert(unauthorized.type === 'force_submit_error', '다른 교사의 요청은 오류여야 합니다');
    assert(unauthorized.payload.code === 'FORBIDDEN', '다른 교사의 요청은 FORBIDDEN이어야 합니다');

    const forceCloseReceived = onlineSocket.waitFor(message => message.type === 'force_close').then(async () => {
      await jsonRequest(`/api/submissions/${onlineSub.id}/submit`, {
        method: 'PUT',
        body: JSON.stringify({ finalMarkdown: '접속 학생의 화면상 최신 글', forceClose: true }),
      }, onlineStudent.token);
    });
    const authorizedResultPromise = requestForceSubmit(ownerSocket, activeAssignmentId, 'owner');
    await forceCloseReceived;
    const authorized = await authorizedResultPromise;
    assert(authorized.type === 'force_submit_ack', '소유 교사의 요청은 성공해야 합니다');
    assert(authorized.payload.targetCount === 2, '작성 중 요청 대상은 2명이어야 합니다');
    assert(authorized.payload.deliveredCount === 1, '접속 중 전달 인원은 1명이어야 합니다');
    assert(authorized.payload.forceClosedCount === 2, '두 제출물이 모두 강제 종료되어야 합니다');
    assert(authorized.payload.failedCount === 0, '강제 종료 실패가 없어야 합니다');

    const after = await jsonRequest(`/api/assignments/${activeAssignmentId}/submissions`, {}, ownerToken);
    const onlineAfter = after.find((item: any) => item.id === onlineSub.id);
    const offlineAfter = after.find((item: any) => item.id === offlineSub.id);
    const alreadyAfter = after.find((item: any) => item.id === alreadySub.id);
    assert(onlineAfter.status === 'FORCE_CLOSED', '접속 학생은 FORCE_CLOSED여야 합니다');
    assert(onlineAfter.final_markdown === '접속 학생의 화면상 최신 글', '접속 학생의 최신 글이 제출되어야 합니다');
    assert(offlineAfter.status === 'FORCE_CLOSED', '미접속 학생은 FORCE_CLOSED여야 합니다');
    assert(offlineAfter.final_markdown === '미접속 학생의 최신 저장 초안', '미접속 학생은 저장 초안으로 제출되어야 합니다');
    assert(alreadyAfter.status === 'SUBMITTED', '이미 제출한 상태는 유지되어야 합니다');
    assert(alreadyAfter.final_markdown === alreadyBefore.final_markdown, '이미 제출한 내용은 바뀌면 안 됩니다');
    assert(String(alreadyAfter.flagia_score) === String(alreadyBefore.flagia_score), '이미 제출한 점수는 바뀌면 안 됩니다');

    const duplicate = await requestForceSubmit(ownerSocket, activeAssignmentId, 'duplicate');
    assert(duplicate.type === 'force_submit_ack', '반복 요청은 안전하게 ACK되어야 합니다');
    assert(duplicate.payload.targetCount === 0, '반복 요청의 새 대상은 0명이어야 합니다');

    if (process.env.TEST_ADMIN_EMAIL && process.env.TEST_ADMIN_PASSWORD) {
      const admin = await jsonRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: process.env.TEST_ADMIN_EMAIL,
          password: process.env.TEST_ADMIN_PASSWORD,
        }),
      });
      const adminSocket = await SocketInbox.connect(admin.token);
      sockets.push(adminSocket);
      const adminResult = await requestForceSubmit(adminSocket, activeAssignmentId, 'admin');
      assert(adminResult.type === 'force_submit_ack', '관리자는 다른 교사의 과제에 실행할 수 있어야 합니다');
    }

    console.log('✓ 접속/미접속 fallback, 권한 거부, 기존 제출 보존, 반복 요청 검증 완료');
  } finally {
    for (const socket of sockets) socket.close();
    if (assignmentId && ownerToken) {
      await jsonRequest(`/api/assignments/${assignmentId}`, { method: 'DELETE' }, ownerToken).catch(() => undefined);
    }
  }
}

run().catch(error => {
  console.error('Force submit integration test failed:', error);
  process.exitCode = 1;
});
