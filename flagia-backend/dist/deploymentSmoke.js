"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/** Scoped production smoke test. Creates and removes only its own test data. */
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const database_1 = __importDefault(require("./database"));
async function main() {
    strict_1.default.equal(process.env.FLAGIA_ALLOW_DEPLOYMENT_SMOKE, '1', 'explicit deployment-smoke flag required');
    const base = 'http://127.0.0.1:3000';
    const nonce = (0, node_crypto_1.randomUUID)();
    const prefix = `deploy-${nonce}`;
    const users = [];
    let assignmentId;
    async function request(path, method = 'GET', body, token, expected = 200) {
        const response = await fetch(base + path, { method,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
        strict_1.default.equal(response.status, expected, `${method} ${path} returned unexpected status`);
        return response.json();
    }
    try {
        const health = await request('/api/health');
        strict_1.default.equal(health.analysisVersion, 5);
        strict_1.default.notEqual(health.linguistic.modelVersion, 'unavailable');
        for (const role of ['TEACHER', 'STUDENT']) {
            const account = await request('/api/auth/register', 'POST', {
                name: '배포 확인용 임시 계정', email: `${prefix}-${role.toLowerCase()}@example.invalid`,
                password: (0, node_crypto_1.randomBytes)(24).toString('base64url'), role,
            }, undefined, 201);
            users.push({ id: account.user.id, token: account.token });
        }
        const [teacher, student] = users;
        const assignment = await request('/api/assignments', 'POST', {
            title: `[배포 확인] ${nonce}`, dueDate: new Date(Date.now() + 86400000).toISOString(),
            timeLimit: 60, textLimit: 3000, maxScore: 100, templateText: '', mode: 'STANDARD',
        }, teacher.token, 201);
        assignmentId = assignment.id;
        const submission = await request('/api/submissions', 'POST', { assignmentId }, student.token, 201);
        const text = '디지털 기술은 교육의 접근성을 높이고, 학습 자료의 다양성을 확대하며, 학생들의 협력을 촉진한다. 그러나 기술의 효과는 기기를 보급하는 것만으로 보장되지 않으며, 교사의 지도와 학습자의 참여가 함께 이루어져야 한다. 첫째, 학교는 모든 학생에게 필요한 기회를 제공하고, 정보 격차를 줄이며, 개인의 상황을 고려해야 한다. 둘째, 학생들은 정보를 비판적으로 검토하고, 출처의 신뢰성을 확인하며, 자신의 생각을 논리적으로 표현해야 한다. 따라서 교육 정책은 편의성과 효율성뿐 아니라, 공정성과 책임성도 함께 고려해야 한다. 이러한 접근은 단기적인 성과를 넘어, 지속 가능한 학습 환경을 만드는 데 기여할 수 있다.';
        const start = Date.now() - 600000;
        const events = Array.from({ length: 1200 }, (_, i) => ({
            seq: i, type: 'keydown', timestamp: start + i * 220, iki: 140 + i % 7 * 30,
            meta: { key: 'Process' }, currentHash: '',
        }));
        await database_1.default.query('INSERT INTO sessions (id, submission_id, start_time, end_time, events_blob) VALUES (?, ?, ?, NOW(), ?)', [(0, node_crypto_1.randomUUID)(), submission.id, new Date(start), JSON.stringify(events)]);
        const submitted = await request(`/api/submissions/${submission.id}/submit`, 'PUT', { finalMarkdown: text }, student.token);
        strict_1.default.ok(submitted.analysis);
        for (const key of ['components', 'scoreAdjustments', 'thresholds', 'evidence'])
            strict_1.default.ok(!(key in submitted.analysis));
        await request(`/api/submissions/${submission.id}/analysis`, 'GET', undefined, undefined, 401);
        await request(`/api/submissions/${submission.id}/analysis/retry`, 'POST', undefined, student.token, 403);
        let report;
        const deadline = Date.now() + 120000;
        do {
            report = await request(`/api/submissions/${submission.id}/analysis`, 'GET', undefined, teacher.token);
            if (report.analysis.linguistic.status !== 'pending')
                break;
            await new Promise(resolve => setTimeout(resolve, 750));
        } while (Date.now() < deadline);
        const result = report.analysis;
        strict_1.default.equal(result.linguistic.status, 'evaluated', 'server must execute the language models');
        strict_1.default.equal(result.linguistic.modelVersion, health.linguistic.modelVersion);
        strict_1.default.equal(result.flagiaScore, Math.max(0, result.linguistic.previousScore - result.linguistic.deduction));
        const studentReport = await request(`/api/submissions/${submission.id}/analysis`, 'GET', undefined, student.token);
        strict_1.default.deepEqual(Object.keys(studentReport.analysis.linguistic), ['status']);
        const [rows] = await database_1.default.query('SELECT flagia_score, flag_status, analysis_json FROM submissions WHERE id = ?', [submission.id]);
        const saved = rows[0];
        strict_1.default.equal(Number(saved.flagia_score), result.flagiaScore);
        strict_1.default.equal(saved.flag_status, result.flagStatus);
        const stored = typeof saved.analysis_json === 'string' ? JSON.parse(saved.analysis_json) : saved.analysis_json;
        strict_1.default.equal(stored.linguistic.status, 'evaluated');
        console.log(JSON.stringify({ status: 'passed', release: health.release, model: health.linguistic.modelVersion,
            deduction: result.linguistic.deduction, appliedDeduction: result.linguistic.appliedDeduction,
            finalScore: result.flagiaScore, authBoundary: true, studentPrivacy: true, persistence: true }));
    }
    finally {
        if (assignmentId && users[0])
            await database_1.default.query('DELETE FROM assignments WHERE id = ? AND teacher_id = ?', [assignmentId, users[0].id]);
        for (const user of users)
            await database_1.default.query('DELETE FROM users WHERE id = ? AND email LIKE ?', [user.id, `${prefix}-%@example.invalid`]);
        await database_1.default.end();
        console.log('Deployment fixture data cleaned up.');
    }
}
main().catch(() => { console.error('Deployment smoke test failed.'); process.exitCode = 1; });
//# sourceMappingURL=deploymentSmoke.js.map