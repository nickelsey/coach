-- Read-only role for analysis over the tailnet (psql, notebooks). Safe to run
-- again; it resets the password. On the NAS, from /volume1/docker/coach/prod/current/deploy:
--
--   read -rs ANALYST_PASSWORD; export ANALYST_PASSWORD
--   sudo -E sh compose.sh prod exec -T -e ANALYST_PASSWORD db \
--     psql -U coach -d coach < sql/analyst-role.sql
--
-- The password comes from the environment so it stays out of this file and
-- out of the process list.
\set ON_ERROR_STOP on
\getenv analyst_password ANALYST_PASSWORD
\if :{?analyst_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'ANALYST_PASSWORD is not set'; END $$;
\endif

SELECT 'CREATE ROLE analyst LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'analyst')
\gexec

ALTER ROLE analyst PASSWORD :'analyst_password';
-- A second lock: the session itself refuses writes.
ALTER ROLE analyst SET default_transaction_read_only = on;

GRANT CONNECT ON DATABASE coach TO analyst;
GRANT USAGE ON SCHEMA public TO analyst;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO analyst;
-- Tables added by later migrations become readable too.
ALTER DEFAULT PRIVILEGES FOR ROLE coach IN SCHEMA public GRANT SELECT ON TABLES TO analyst;
