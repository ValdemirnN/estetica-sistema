-- Testes da migration 20261118000100 (rode depois das migrations 1-4; veja README desta pasta).
\set QUIET on
\pset format unaligned
\pset tuples_only on
create schema if not exists t; grant usage on schema t to anon, authenticated;
create or replace function t.login(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u::text, false); perform set_config('role','authenticated',false); end $$;
create or replace function t.anon() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', false); perform set_config('role','anon',false); end $$;
create or replace function t.fails(q text) returns text language plpgsql as $$ declare n int; begin execute q; get diagnostics n = row_count; if n = 0 and q ~* '^(update|delete)' then return 'BLOCKED(0 rows)'; end if; return 'UNEXPECTEDLY-OK'; exception when others then return 'BLOCKED: '||left(sqlerrm,90); end $$;
create or replace function t.cnt(q text) returns bigint language plpgsql as $$ declare n bigint; begin execute 'select count(*) from ('||q||') x' into n; return n; end $$;
\set admin  '''11111111-1111-1111-1111-111111111111'''
\set valde  '''22222222-2222-2222-2222-222222222222'''
\set camila '''33333333-3333-3333-3333-333333333333'''
select set_config('app.aes', (select id::text from clinics where slug='aesthetiq'), false);
select set_config('app.base', (date_trunc('week', now()) + interval '14 days' + interval '2 days')::text, false); -- quarta daqui a 2 semanas, 00:00 no fuso da sessão

\echo '== 1. anamnese removida'
select 'tabela anamnesis_records existe? '||(to_regclass('public.anamnesis_records') is not null);
select 'coluna requires_anamnesis existe? '||exists(select 1 from information_schema.columns where table_name='services' and column_name='requires_anamnesis');
select 'funcao staff_view_anamnesis existe? '||exists(select 1 from pg_proc where proname in ('staff_view_anamnesis','staff_list_anamnesis'));

\echo '== 2. clientes e observacoes (so equipe)'
select t.login(:valde);
select 'cliente lista clientes (esperado 0): '||count(*) from public.staff_list_clients(current_setting('app.aes')::uuid);
select 'cliente grava observacao: '||t.fails($q$select public.staff_set_client_notes(current_setting('app.aes')::uuid, '22222222-2222-2222-2222-222222222222', 'x')$q$);
select 'cliente le tabela de notas direto: '||t.fails($q$select * from public.clinic_client_notes$q$);
reset role;
select t.login(:admin);
select public.staff_set_client_notes(current_setting('app.aes')::uuid, :valde, 'Prefere manhã');
select 'admin lista clientes: '||string_agg(full_name||' / '||staff_notes, ' | ') from public.staff_list_clients(current_setting('app.aes')::uuid);
reset role;

\echo '== 3. remarcacao'
select t.login(:admin);
-- agenda quarta 10:00 BRT (13:00 UTC) para o cliente
select set_config('app.apt', public.book_appointment('a1111111-1111-1111-1111-111111111111', (current_setting('app.base')::timestamptz + interval '10 hours'), null, null, :valde)::text, false);
select 'notificacoes na fila apos agendar: '||count(*) from notifications_log where appointment_id = current_setting('app.apt')::uuid and status='QUEUED';
-- outro agendamento ocupando quarta 14:00 BRT (17:00 UTC)
select set_config('app.apt2', public.book_appointment('a2222222-2222-2222-2222-222222222222', (current_setting('app.base')::timestamptz + interval '14 hours'), null, null, :valde)::text, false);
-- remarcar para 15:00 BRT (18:00 UTC) = conflito com apt2? apt2 vai de 17:00 UTC + 45min + buffer 15 => 18:00 UTC. 18:00 já livre
select public.reschedule_appointment(current_setting('app.apt')::uuid, current_setting('app.base')::timestamptz + interval '16 hours');
select 'novo horario (Brasilia): '||to_char(start_time at time zone 'America/Sao_Paulo','HH24:MI')||' fim '||to_char(end_time at time zone 'America/Sao_Paulo','HH24:MI') from appointments where id=current_setting('app.apt')::uuid;
select 'nota interna: '||internal_staff_notes from appointments where id=current_setting('app.apt')::uuid;
select 'fila apos remarcar: '||string_agg(template_name, ',' order by template_name) from notifications_log where appointment_id = current_setting('app.apt')::uuid and status='QUEUED';
select 'remarca sobre outro agendamento: '||t.fails($q$select public.reschedule_appointment(current_setting('app.apt')::uuid, current_setting('app.base')::timestamptz + interval '14 hours 30 minutes')$q$);
select 'remarca fora da jornada (22h): '||t.fails($q$select public.reschedule_appointment(current_setting('app.apt')::uuid, current_setting('app.base')::timestamptz + interval '1 hour')$q$);
select 'remarca para o passado: '||t.fails($q$select public.reschedule_appointment(current_setting('app.apt')::uuid, now() - interval '1 day')$q$);
select public.reschedule_appointment(current_setting('app.apt')::uuid, current_setting('app.base')::timestamptz + interval '16 hours');
select 'remarcar no mesmo horario (ele mesmo): ok';
reset role;
select t.login(:valde);
select 'cliente tenta remarcar: '||t.fails($q$select public.reschedule_appointment(current_setting('app.apt')::uuid, current_setting('app.base')::timestamptz + interval '17 hours')$q$);
reset role;
select t.login(:admin);
select public.update_appointment_status(current_setting('app.apt')::uuid, 'CANCELLED', 'teste');
select 'remarcar cancelado: '||t.fails($q$select public.reschedule_appointment(current_setting('app.apt')::uuid, current_setting('app.base')::timestamptz + interval '17 hours')$q$);
reset role;
