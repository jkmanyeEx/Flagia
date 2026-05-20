"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = __importDefault(require("./database"));
async function debug() {
    // Get both submissions' analysis
    const [rows] = await database_1.default.query(`SELECT s.id, s.flagia_score, s.flag_status, s.analysis_json
     FROM submissions s WHERE s.id IN (?, ?)`, ['7a3281c2-0924-4046-81dd-923e7bf359a2', 'ce65d9dc-a7de-45dc-8292-e3c27f5622ef']);
    for (const sub of rows) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Submission: ${sub.id.slice(0, 8)}… | Score: ${sub.flagia_score} | Status: ${sub.flag_status}`);
        if (sub.analysis_json) {
            const a = JSON.parse(sub.analysis_json);
            console.log(`  Cv: ${a.coefficientOfVariation} → score: ${a.components?.typingRhythm?.raw}`);
            console.log(`  RR: ${a.revisionRatio} → score: ${a.components?.revisionRatio?.raw}`);
            console.log(`  Paste: count=${a.totalPasteCount} → score: ${a.components?.externalContent?.raw}`);
            console.log(`  Blur: ${a.totalBlurDuration}s → score: ${a.components?.focusDuration?.raw}`);
            console.log(`  Components:`, JSON.stringify(a.components, null, 2));
        }
    }
    // Check events for the AI submission to understand rhythm
    console.log(`\n${'='.repeat(60)}`);
    console.log('AI submission (7a3281c2) events sample:');
    const [sess1] = await database_1.default.query('SELECT events_blob FROM sessions WHERE submission_id = ? ORDER BY start_time ASC', ['7a3281c2-0924-4046-81dd-923e7bf359a2']);
    for (const s of sess1) {
        if (s.events_blob) {
            const events = JSON.parse(s.events_blob);
            console.log(`  Total events: ${events.length}`);
            events.slice(0, 15).forEach((e, i) => {
                console.log(`  [${i}] type=${e.type} iki=${e.iki} key=${e.meta?.key} pos=${e.meta?.cursorPosition} pasteLen=${e.meta?.pasteLength}`);
            });
        }
    }
    // Check events for the human submission - sample Korean typing
    console.log(`\n${'='.repeat(60)}`);
    console.log('Human submission (ce65d9dc) Korean typing sample:');
    const [sess2] = await database_1.default.query('SELECT events_blob FROM sessions WHERE submission_id = ? ORDER BY start_time ASC', ['ce65d9dc-a7de-45dc-8292-e3c27f5622ef']);
    for (const s of sess2) {
        if (s.events_blob) {
            const events = JSON.parse(s.events_blob);
            console.log(`  Total events: ${events.length}`);
            // Find Korean keydown events
            const koreanEvents = events.filter((e) => e.type === 'keydown' && e.meta?.key && /[\uac00-\ud7af\u3131-\u3163\u314f-\u3163]/.test(e.meta.key));
            console.log(`  Korean keydown events: ${koreanEvents.length}`);
            koreanEvents.slice(0, 30).forEach((e, i) => {
                console.log(`  [${i}] key=${e.meta?.key} pos=${e.meta?.cursorPosition} iki=${e.iki}`);
            });
        }
    }
    process.exit(0);
}
debug().catch(e => { console.error(e); process.exit(1); });
//# sourceMappingURL=debug_events.js.map