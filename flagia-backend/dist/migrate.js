"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureSchema = ensureSchema;
const database_1 = __importDefault(require("./database"));
/**
 * Idempotent schema migrations, run on every boot (see index.ts).
 *
 * Why on boot: production runs on a separate host whose database we can't always
 * reach directly. Running these guarded ALTERs at startup lets a plain redeploy
 * bring an older database up to the schema the current code expects — no manual
 * SQL required. Every step is safe to run repeatedly and is wrapped so a single
 * failure (e.g. missing ALTER privilege) logs a warning instead of crashing boot.
 */
async function columnExists(table, column) {
    const [rows] = await database_1.default.query(`SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, column]);
    return rows[0].c > 0;
}
async function ensureSchema() {
    const steps = [
        {
            // Admin role. MODIFY is itself idempotent (a no-op if the enum already matches).
            name: "users.role includes ADMIN",
            run: async () => {
                await database_1.default.query("ALTER TABLE users MODIFY COLUMN role ENUM('TEACHER','STUDENT','ADMIN') NOT NULL DEFAULT 'STUDENT'");
            },
        },
        {
            // Persisted active-writing-time budget (resumable timer).
            name: "submissions.time_spent_sec",
            run: async () => {
                if (!(await columnExists('submissions', 'time_spent_sec'))) {
                    await database_1.default.query("ALTER TABLE submissions ADD COLUMN time_spent_sec INT NOT NULL DEFAULT 0 " +
                        "COMMENT 'Cumulative active writing seconds across sessions (excludes time away from the site)' AFTER status");
                }
            },
        },
        {
            // Remove a leftover column from the abandoned "continuable" experiment.
            // Current code never references it; dropping it keeps old/new schema aligned.
            name: "drop leftover assignments.continuable",
            run: async () => {
                if (await columnExists('assignments', 'continuable')) {
                    await database_1.default.query('ALTER TABLE assignments DROP COLUMN continuable');
                }
            },
        },
        {
            // Seed the admin accounts. Runs after the role-enum step above so the
            // ADMIN value is valid. Plain UPDATE (no ALTER needed), so it works via the
            // app's own DB user. Re-asserted on every boot — these accounts stay admin.
            name: "promote admin accounts to ADMIN",
            run: async () => {
                const ADMIN_EMAILS = [
                    'devmeko463@gmail.com', // owner
                    'teacherhan@gmail.com', // 한지로
                ];
                await database_1.default.query("UPDATE users SET role = 'ADMIN' WHERE email IN (?) AND role <> 'ADMIN'", [ADMIN_EMAILS]);
            },
        },
    ];
    for (const step of steps) {
        try {
            await step.run();
            console.log(`  ✅ schema ok: ${step.name}`);
        }
        catch (err) {
            console.error(`  ⚠️  schema step failed (continuing): ${step.name} — ${err.code || err.message}`);
        }
    }
}
//# sourceMappingURL=migrate.js.map