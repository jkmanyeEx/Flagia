"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/** Real finalizer + queue + local model, with an in-memory SQL adapter. No live DB. */
const strict_1 = __importDefault(require("node:assert/strict"));
const database_1 = __importDefault(require("../database"));
const submissionFinalizer_1 = require("./submissionFinalizer");
const submissionAnalysis_1 = require("./submissionAnalysis");
const runtime_1 = require("../linguistic/runtime");
async function main() {
    strict_1.default.notEqual((0, runtime_1.linguisticModelVersion)(), 'unavailable');
    const markdown = '학교에서 휴대전화를 사용하는 문제는 단순히 금지와 허용으로 나눌 수 없다. 학생은 필요한 자료를 찾아 학습에 활용할 수 있지만 수업에 집중하지 못하는 상황도 생긴다. 따라서 학교는 학생과 교사가 함께 사용할 시간과 장소를 정해야 한다. 모든 학생에게 같은 규칙을 적용하되 학습에 필요한 예외는 충분히 설명할 필요가 있다. 이러한 규칙은 실제 경험을 바탕으로 정기적으로 다시 검토해야 한다.';
    const row = { id: 'test-submission', assignment_id: 'test-assignment', student_id: 'test-student',
        status: 'IN_PROGRESS', final_markdown: '', template_text: '', mode: 'STANDARD', submitted_at: '2026-10-18T00:00:00Z' };
    const events = Array.from({ length: 1200 }, (_, i) => ({
        seq: i, type: 'keydown', timestamp: Date.parse(row.submitted_at) - 300000 + i * 200, iki: 150 + i % 7 * 20,
        meta: { key: 'Process' }, currentHash: '',
    }));
    let writes = 0;
    const query = database_1.default.query;
    database_1.default.query = async (sql, args) => {
        if (sql.includes("status = ?") && sql.includes("status = 'IN_PROGRESS'")) {
            const affectedRows = row.status === 'IN_PROGRESS' ? 1 : 0;
            if (affectedRows) {
                row.final_markdown = args[0];
                row.status = args[1];
            }
            return [{ affectedRows }];
        }
        if (sql.includes('SELECT s.*'))
            return [[{ ...row }]];
        if (sql.includes('SELECT events_blob'))
            return [[{ events_blob: JSON.stringify(events) }]];
        if (sql.includes('UPDATE submissions SET flagia_score')) {
            if (row.final_markdown !== args[8])
                return [{ affectedRows: 0 }];
            if (args.length > 9 && JSON.parse(row.analysis_json).sourceFingerprint !== args[9])
                return [{ affectedRows: 0 }];
            if (args.length > 10 && JSON.parse(row.analysis_json).linguistic.modelVersion !== args[10])
                return [{ affectedRows: 0 }];
            if (args.length > 11 && JSON.parse(row.analysis_json).linguistic.policyVersion !== args[11])
                return [{ affectedRows: 0 }];
            row.flagia_score = args[0];
            row.flag_status = args[1];
            row.analysis_json = args[6];
            writes++;
            return [{ affectedRows: 1 }];
        }
        throw new Error('Unexpected SQL in isolated test');
    };
    try {
        const [first, second] = await Promise.all([
            (0, submissionFinalizer_1.finalizeSubmission)({ submissionId: row.id, status: 'SUBMITTED', finalMarkdown: markdown }),
            (0, submissionFinalizer_1.finalizeSubmission)({ submissionId: row.id, status: 'FORCE_CLOSED', finalMarkdown: markdown }),
        ]);
        strict_1.default.equal(first.outcome, 'finalized');
        strict_1.default.equal(second.outcome, 'already_finalized');
        strict_1.default.equal(first.analysis.linguistic.status, 'pending');
        strict_1.default.ok((0, submissionAnalysis_1.activeAnalysisStage)(row.id));
        const deadline = Date.now() + 30000;
        while ((0, submissionAnalysis_1.activeAnalysisStage)(row.id) && Date.now() < deadline)
            await new Promise(r => setTimeout(r, 50));
        strict_1.default.equal((0, submissionAnalysis_1.activeAnalysisStage)(row.id), undefined, 'background work must finish');
        const final = JSON.parse(row.analysis_json);
        strict_1.default.equal(final.linguistic.status, 'evaluated');
        strict_1.default.equal(row.flagia_score, final.flagiaScore);
        strict_1.default.equal(row.flag_status, final.flagStatus);
        strict_1.default.equal(writes, 2, 'one initial and one final result, despite concurrent submission');
        const stored = row.analysis_json;
        await (0, submissionAnalysis_1.saveSubmissionAnalysis)(row.id, final, 'stale different document');
        strict_1.default.equal(row.analysis_json, stored, 'stale work must not overwrite a newer document');
        await (0, submissionAnalysis_1.saveSubmissionAnalysis)(row.id, { ...final, sourceFingerprint: 'stale-mode' }, markdown, true);
        strict_1.default.equal(row.analysis_json, stored, 'stale model/mode work must not overwrite a newer analysis');
        await (0, submissionAnalysis_1.saveSubmissionAnalysis)(row.id, { ...final, linguistic: { ...final.linguistic, modelVersion: 'old-model' } }, markdown, true);
        strict_1.default.equal(row.analysis_json, stored, 'old model work must not overwrite a newer model result');
        console.log('Finalization race, asynchronous persistence, score columns and stale-write tests passed.');
    }
    finally {
        database_1.default.query = query;
        runtime_1.linguisticRuntime.close();
        await database_1.default.end();
    }
}
main().catch(error => { runtime_1.linguisticRuntime.close(); console.error(error); process.exitCode = 1; });
//# sourceMappingURL=submissionAnalysis_test.js.map