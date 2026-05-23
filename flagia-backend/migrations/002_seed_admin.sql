-- ============================================================================
-- Migration 002: promote the owner account to ADMIN
-- ----------------------------------------------------------------------------
-- Idempotent and safe to re-run. Runs after 001 (which guarantees the role enum
-- includes ADMIN). The backend also re-asserts this on boot (ensureSchema), but
-- this SQL path is the reliable one when the app code itself is behind.
-- ============================================================================

UPDATE users
SET role = 'ADMIN'
WHERE email IN ('devmeko463@gmail.com', 'teacherhan@gmail.com') AND role <> 'ADMIN';
