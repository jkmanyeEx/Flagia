import pool from './database';

/**
 * Idempotent schema migrations, run on every boot (see index.ts).
 *
 * Why on boot: production runs on a separate host whose database we can't always
 * reach directly. Running these guarded ALTERs at startup lets a plain redeploy
 * bring an older database up to the schema the current code expects — no manual
 * SQL required. Every step is safe to run repeatedly and is wrapped so a single
 * failure (e.g. missing ALTER privilege) logs a warning instead of crashing boot.
 */

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return (rows as any[])[0].c > 0;
}

export async function ensureSchema(): Promise<void> {
  const steps: { name: string; run: () => Promise<void> }[] = [
    {
      // Admin role. MODIFY is itself idempotent (a no-op if the enum already matches).
      name: "users.role includes ADMIN",
      run: async () => {
        await pool.query(
          "ALTER TABLE users MODIFY COLUMN role ENUM('TEACHER','STUDENT','ADMIN') NOT NULL DEFAULT 'STUDENT'"
        );
      },
    },
    {
      // Persisted active-writing-time budget (resumable timer).
      name: "submissions.time_spent_sec",
      run: async () => {
        if (!(await columnExists('submissions', 'time_spent_sec'))) {
          await pool.query(
            "ALTER TABLE submissions ADD COLUMN time_spent_sec INT NOT NULL DEFAULT 0 " +
            "COMMENT 'Cumulative active writing seconds across sessions (excludes time away from the site)' AFTER status"
          );
        }
      },
    },
    {
      // Remove a leftover column from the abandoned "continuable" experiment.
      // Current code never references it; dropping it keeps old/new schema aligned.
      name: "drop leftover assignments.continuable",
      run: async () => {
        if (await columnExists('assignments', 'continuable')) {
          await pool.query('ALTER TABLE assignments DROP COLUMN continuable');
        }
      },
    },
    {
      // Seed the owner/admin account. Runs after the role-enum step above so the
      // ADMIN value is valid. Plain UPDATE (no ALTER needed), so it works via the
      // app's own DB user. Re-asserted on every boot — this account stays admin.
      name: "promote owner account to ADMIN",
      run: async () => {
        await pool.query(
          "UPDATE users SET role = 'ADMIN' WHERE email = ? AND role <> 'ADMIN'",
          ['devmeko463@gmail.com']
        );
      },
    },
  ];

  for (const step of steps) {
    try {
      await step.run();
      console.log(`  ✅ schema ok: ${step.name}`);
    } catch (err: any) {
      console.error(`  ⚠️  schema step failed (continuing): ${step.name} — ${err.code || err.message}`);
    }
  }
}
