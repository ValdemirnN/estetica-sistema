-- Testes da migration 20261119000100 (rode depois das migrations 1-5; veja README desta pasta).
\set QUIET on
\pset format unaligned
\pset tuples_only on
create schema if not exists t; grant usage on schema t to anon, authenticated;
create or replace function t.login(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u::text, false); perform set_config('role','authenticated',false); end $$;
create or replace function t.fails(q text) returns text language plpgsql as $$ declare n int; begin execute q; get diagnostics n = row_count; if n = 0 and q ~* '^(update|delete)' then return 'BLOCKED(0 rows)'; end if; return 'UNEXPECTEDLY-OK'; exception when others then return 'BLOCKED: '||left(sqlerrm,90); end $$;
\set admin '''11111111-1111-1111-1111-111111111111'''
\set valde '''22222222-2222-2222-2222-222222222222'''
select set_config('app.svc', (select id::text from services where clinic_id=(select id from clinics where slug='aesthetiq') limit 1), false);

\echo '== 1. coluna existe e aceita NULL (esperado: true)'
select exists(select 1 from information_schema.columns where table_name='services' and column_name='return_interval_days');

\echo '== 2. admin define intervalo valido (esperado: UNEXPECTEDLY-OK = permitido)'
select t.login(:admin);
select 'intervalo 30: '||t.fails($q$update public.services set return_interval_days = 30 where id = current_setting('app.svc')::uuid$q$);
select 'intervalo NULL: '||t.fails($q$update public.services set return_interval_days = null where id = current_setting('app.svc')::uuid$q$);

\echo '== 3. limites no banco (esperado: BLOCKED)'
select 'intervalo 0: '||t.fails($q$update public.services set return_interval_days = 0 where id = current_setting('app.svc')::uuid$q$);
select 'intervalo negativo: '||t.fails($q$update public.services set return_interval_days = -5 where id = current_setting('app.svc')::uuid$q$);
select 'intervalo 731: '||t.fails($q$update public.services set return_interval_days = 731 where id = current_setting('app.svc')::uuid$q$);
reset role;

\echo '== 4. cliente nao altera o intervalo (esperado: BLOCKED)'
select t.login(:valde);
select 'cliente altera intervalo: '||t.fails($q$update public.services set return_interval_days = 10 where id = current_setting('app.svc')::uuid$q$);
reset role;
