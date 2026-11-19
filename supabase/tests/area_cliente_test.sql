-- Testes da migration 20261121000100 (Fase 4). Rode num banco recém-criado, depois das migrations 1-7
-- e de 01_seed_legacy.sql, com: PGTZ=America/Sao_Paulo psql teste -f area_cliente_test.sql
\set QUIET on
\pset format unaligned
\pset tuples_only on
create schema if not exists t; grant usage on schema t to anon, authenticated;
create or replace function t.login(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u::text, false); perform set_config('role','authenticated',false); end $$;
create or replace function t.fails(q text) returns text language plpgsql as $$ begin execute q; return 'UNEXPECTEDLY-OK'; exception when others then return 'BLOCKED: '||left(sqlerrm,90); end $$;
\set admin  '''11111111-1111-1111-1111-111111111111'''
\set valde  '''22222222-2222-2222-2222-222222222222'''
select set_config('app.aes', (select id::text from clinics where slug='aesthetiq'), false);
select set_config('app.base', (date_trunc('week', now()) + interval '14 days' + interval '2 days')::text, false);

\echo '== 1. cliente remarca o proprio agendamento'
select t.login(:admin);
select set_config('app.apt', public.book_appointment('a1111111-1111-1111-1111-111111111111', current_setting('app.base')::timestamptz + interval '10 hours', null, null, :valde)::text, false);
reset role;
select t.login(:valde);
select public.reschedule_my_appointment(current_setting('app.apt')::uuid, current_setting('app.base')::timestamptz + interval '16 hours');
select 'novo horario 16:00: '||(to_char(start_time at time zone 'America/Sao_Paulo','HH24:MI')='16:00') from appointments where id=current_setting('app.apt')::uuid;
select 'nota cita o cliente: '||(internal_staff_notes like '%pelo cliente%') from appointments where id=current_setting('app.apt')::uuid;
select 'fora da jornada: '||t.fails($q$select public.reschedule_my_appointment(current_setting('app.apt')::uuid, current_setting('app.base')::timestamptz + interval '1 hour')$q$);
select 'passado: '||t.fails($q$select public.reschedule_my_appointment(current_setting('app.apt')::uuid, now() - interval '1 day')$q$);
reset role;

\echo '== 2. antecedencia minima (validada no banco)'
update clinics set min_cancel_notice_hours = 24*30 where slug='aesthetiq';
select t.login(:valde);
select 'dentro da antecedencia: '||t.fails($q$select public.reschedule_my_appointment(current_setting('app.apt')::uuid, current_setting('app.base')::timestamptz + interval '17 hours')$q$);
reset role;
update clinics set min_cancel_notice_hours = 24 where slug='aesthetiq';

\echo '== 3. agendamento de outro cliente'
select t.login('33333333-3333-3333-3333-333333333333');
select 'cliente alheio: '||t.fails($q$select public.reschedule_my_appointment(current_setting('app.apt')::uuid, current_setting('app.base')::timestamptz + interval '17 hours')$q$);
reset role;

\echo '== 4. equipe continua remarcando'
select t.login(:admin);
select public.reschedule_appointment(current_setting('app.apt')::uuid, current_setting('app.base')::timestamptz + interval '15 hours');
select 'equipe remarcou 15:00: '||(to_char(start_time at time zone 'America/Sao_Paulo','HH24:MI')='15:00') from appointments where id=current_setting('app.apt')::uuid;
reset role;
select t.login(:valde);
select 'cliente nao usa a funcao da equipe: '||t.fails($q$select public.reschedule_appointment(current_setting('app.apt')::uuid, current_setting('app.base')::timestamptz + interval '17 hours')$q$);
reset role;

\echo '== 5. editar cadastro'
select t.login(:valde);
select public.update_my_profile('Valdirene Souza', '(11) 98888-7777', false, true);
select 'perfil: '||full_name||' / '||phone||' / wa='||opt_in_whatsapp||' mail='||opt_in_email from profiles where id=:valde;
select 'fila passou para EMAIL: '||string_agg(distinct channel::text, ',') from notifications_log where recipient_id=:valde and status='QUEUED';
select 'nome curto: '||t.fails($q$select public.update_my_profile('Al', '(11) 98888-7777', true, true)$q$);
select 'telefone invalido: '||t.fails($q$select public.update_my_profile('Valdirene Souza', '123', true, true)$q$);
select public.update_my_profile('Valdirene Souza', '(11) 98888-7777', false, false);
select 'fila vazia com tudo desligado: '||count(*) from notifications_log where recipient_id=:valde and status='QUEUED';
select 'trocar e-mail direto: '||t.fails($q$update profiles set email='x@x.com' where id='22222222-2222-2222-2222-222222222222'$q$);
reset role;

\echo '== 6. exclusao LGPD'
select t.login(:valde);
select public.request_account_deletion(current_setting('app.aes')::uuid, 'quero sair');
select public.request_account_deletion(current_setting('app.aes')::uuid, 'de novo');
select 'pendentes (esperado 1): '||count(*) from account_deletion_requests where user_id=:valde and status='PENDING';
select 'escrita direta: '||t.fails($q$update account_deletion_requests set status='DONE'$q$);
select public.cancel_account_deletion_request(current_setting('app.aes')::uuid);
select 'pendentes apos cancelar (0): '||count(*) from account_deletion_requests where user_id=:valde and status='PENDING';
select 'cancelar sem pedido: '||t.fails($q$select public.cancel_account_deletion_request(current_setting('app.aes')::uuid)$q$);
select public.request_account_deletion(current_setting('app.aes')::uuid, null);
reset role;
select t.login(:admin);
select 'equipe enxerga o pedido: '||count(*) from account_deletion_requests where status='PENDING';
reset role;
