-- ============================================================================
-- 0001_extensions.sql
-- TrustVault initial migration: extensions.
--
-- Deliberate choice: NO extensions. gen_random_uuid() and sha256() are built
-- into PostgreSQL 13+; case-insensitive email matching is done with lower()
-- (emails are stored normalised lowercase + CHECK constraint). This removes a
-- class of environment bugs (extensions schema differences) entirely.
-- ============================================================================

-- Nothing to install. Placeholder kept so the migration list stays explicit.
select 1;
