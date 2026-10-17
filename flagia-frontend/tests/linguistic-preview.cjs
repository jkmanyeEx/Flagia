/* Local UI fixture server only. Never imported by the application. No SQL. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('../../flagia-backend/node_modules/ws');
const { runFlagiaAnalysis } = require('../../flagia-backend/dist/engine/flagiaEngine');
const { applyLinguisticResult, studentAnalysis } = require('../../flagia-backend/dist/linguistic/pipeline');
const root = path.resolve(__dirname, '../dist');
const stateFile = path.resolve(__dirname, '../../flagia-backend/.linguistic-local/preview-state.json');
const defaultState = { variant: 'evaluated', role: 'TEACHER' };
function state() { try { return { ...defaultState, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch { return defaultState; } }
function fixture(config) {
  const base = runFlagiaAnalysis([], '', '', 'STANDARD');
  Object.assign(base, { flagiaScore: 95, baseScore: 95, flagStatus: 'GREEN', scoreAdjustments: [],
    verdict: '입력 지표 분석 완료', verdictDetail: '화면 검증용 가상 제출물입니다.',
    sessionSummary: { totalDurationSec: 1500, sessionCount: 1, totalKeystrokes: 4200, totalCharactersTyped: 1800, averageWPM: 40 } });
  for (const comp of Object.values(base.components)) Object.assign(comp, {
    raw: 95, weighted: Math.round(95 * comp.weight * 100) / 100, status: 'good', description: '화면 검증용 지표입니다.',
  });
  if (config.variant !== 'evaluated') {
    base.linguistic = { status: config.variant === 'pending' ? 'pending' : 'unevaluated', stage: 'context',
      reason: config.variant === 'failure' ? 'timeout' : 'too_short',
      previousScore: 95, deduction: 0, appliedDeduction: 0, policyVersion: 'ko-deduction-v1', modelVersion: 'ui-fixture' };
    return base;
  }
  return applyLinguisticResult(base, { status: 'evaluated', modelVersion: 'ui-fixture', validation: 'provisional',
    featureScore: .94, contextScore: .99, thresholds: { aReview: .7, aStrong: .9, bReview: .8 }, calibrationHumanCount: 29,
    evidence: [{ feature: 'comma_sentence_share', value: .58, contribution: 1.2 }, { feature: 'ending_diversity', value: .32, contribution: -.25 }],
    revisions: { status: 'evaluated', stableSentenceCount: 6, surfaceEdits: 2, rewordings: 1, meaningEdits: 1, unknownEdits: 1,
      meaningChangeRatio: .02, method: 'stable-sentence-operators-v1', examples: [{ kind: 'meaning',
        before: '모든 학생에게 동일한 규칙을 적용해야 한다.', after: '일부 학생에게는 다른 규칙을 적용해야 한다.' }] },
  }, 'STANDARD');
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2' };
async function handle(req, res) {
  const config = state(); const url = new URL(req.url, 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5171');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, accept-language');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  function json(value) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); }
  const user = { id: 'fixture-user', name: '검증용 계정', email: 'preview@example.test', role: config.role };
  if (url.pathname === '/api/auth/me') return json({ user });
  if (url.pathname === '/api/auth/login') return json({ user, token: 'local-ui-fixture' });
  if (url.pathname.endsWith('/analysis/retry')) {
    fs.writeFileSync(stateFile, JSON.stringify({ ...config, variant: 'pending' })); return json({ status: 'queued' });
  }
  if (url.pathname.endsWith('/analysis')) {
    const result = fixture(config);
    return json({ submission: { id: 'linguistic-preview', assignmentId: 'fixture-assignment', studentId: 'fixture-user',
      assignmentTitle: '언어 분석 화면 검증', studentName: '검증용 작성자', studentEmail: 'writer@example.test',
      status: 'SUBMITTED', mode: 'STANDARD', submittedAt: '2026-10-18T00:00:00Z', maxScore: 100, textLimit: 3000, timeLimit: 60,
      finalMarkdown: '<p>화면 검증용 가상 제출물입니다.</p>', templateText: '', score: null, feedback: '' },
      analysis: config.role === 'STUDENT' ? studentAnalysis(result) : result });
  }
  if (url.pathname.endsWith('/events')) return json({ events: [] });
  if (url.pathname.startsWith('/api/')) return json([]);
  let file = path.resolve(root, '.' + url.pathname);
  if (!file.startsWith(root + path.sep)) file = path.join(root, 'index.html');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}
for (const port of [3000, 5171]) {
  const server = http.createServer(handle);
  const ws = new WebSocketServer({ server, path: '/ws' });
  ws.on('connection', socket => socket.on('message', () => socket.send(JSON.stringify({ type: 'auth_ok' }))));
  server.listen(port, '127.0.0.1', () => console.log(`Local fixture server listening on ${port}`));
}
