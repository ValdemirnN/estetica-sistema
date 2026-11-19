-- Testes da migration 20261122000100 (Fase 5). Rode num banco recém-criado, depois das migrations 1-8
-- e de 01_seed_legacy.sql:  PGTZ=America/Sao_Paulo psql teste -f notificacoes_test.sql
\set QUIET on
\pset format unaligned
\pset tuples_only on
create schema if not exists t; grant usage on schema t to anon, authenticated, service_role;
create or replace function t.login(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u::text, false); perform set_config('role','authenticated',false); end $$;
create or replace function t.fails(q text) returns text language plpgsql as $$ begin execute q; return 'UNEXPECTEDLY-OK'; exception when others then return 'BLOCKED: '||left(sqlerrm,90); end $$;
\set admin  '''11111111-1111-1111-1111-111111111111'''
\set valde  '''22222222-2222-2222-2222-222222222222'''
\set camila '''33333333-3333-3333-3333-333333333333'''
select set_config('app.aes', (select id::text from clinics where slug='aesthetiq'), false);
select set_config('app.base', (date_trunc('week', now()) + interval '21 days' + interval '2 days')::text, false);

-- o cliente precisa ter aceitado avisos (testes anteriores podem ter desligado)
update profiles set opt_in_whatsapp = true, opt_in_email = true, phone = '(11) 98888-7777' where id = :valde;
\echo '== 1. agendar cria confirmacao + 24h + 2h'
select t.login(:admin);
select set_config('app.apt', public.book_appointment('a1111111-1111-1111-1111-111111111111', current_setting('app.base')::timestamptz + interval '10 hours', null, null, :valde)::text, false);
reset role;
select 'avisos: '||string_agg(template_name, ',' order by template_name) from notifications_log where appointment_id=current_setting('app.apt')::uuid and status::text='QUEUED';
select '2h agendado para 08:00: '||(to_char(scheduled_for at time zone 'America/Sao_Paulo','HH24:MI')='08:00') from notifications_log where appointment_id=current_setting('app.apt')::uuid and template_name='appointment_reminder_2h';

\echo '== 2. idempotencia'
insert into notifications_log (clinic_id, appointment_id, recipient_id, channel, status, template_name, recipient_address, payload, scheduled_for)
select clinic_id, appointment_id, recipient_id, channel, 'QUEUED', template_name, recipient_address, payload, scheduled_for
  from notifications_log where appointment_id=current_setting('app.apt')::uuid and template_name='appointment_reminder_24h';
select '24h continua unico (1): '||count(*) from notifications_log where appointment_id=current_setting('app.apt')::uuid and template_name='appointment_reminder_24h';
select 'dedupe_key preenchida: '||bool_and(dedupe_key is not null) from notifications_log where appointment_id=current_setting('app.apt')::uuid;

\echo '== 3. remarcar troca os avisos (inclui o de 2h)'
select t.login(:admin);
select public.reschedule_appointment(current_setting('app.apt')::uuid, current_setting('app.base')::timestamptz + interval '16 hours');
reset role;
select 'avisos apos remarcar: '||string_agg(template_name, ',' order by template_name) from notifications_log where appointment_id=current_setting('app.apt')::uuid and status::text='QUEUED';
select '2h agora 14:00: '||(to_char(scheduled_for at time zone 'America/Sao_Paulo','HH24:MI')='14:00') from notifications_log where appointment_id=current_setting('app.apt')::uuid and template_name='appointment_reminder_2h';

\echo '== 4. claim_notifications (so service_role)'
set role authenticated; select 'authenticated executa claim: '||t.fails($q$select * from public.claim_notifications(5)$q$); reset role;
update notifications_log set scheduled_for = now() - interval '1 minute' where appointment_id=current_setting('app.apt')::uuid and template_name in ('appointment_rescheduled','appointment_reminder_24h');
set role service_role;
select 'claim 1 (esperado 2): '||count(*) from public.claim_notifications(10);
select 'claim 2 sem duplicar (esperado 0): '||count(*) from public.claim_notifications(10);
reset role;
select 'reservados: '||count(*) from notifications_log where appointment_id=current_setting('app.apt')::uuid and locked_at is not null;
update notifications_log set locked_at = now() - interval '11 minutes' where appointment_id=current_setting('app.apt')::uuid;
set role service_role;
select 'reserva abandonada volta (2): '||count(*) from public.claim_notifications(10);
reset role;

\echo '== 5. reenviar (equipe)'
update notifications_log set status='FAILED', error_message='teste' where appointment_id=current_setting('app.apt')::uuid and template_name='appointment_rescheduled';
select t.login(:valde);
select 'cliente reenvia: '||t.fails(format($q$select public.staff_requeue_notification(%L)$q$, (select id from notifications_log where appointment_id=current_setting('app.apt')::uuid and template_name='appointment_rescheduled')));
reset role;
select t.login(:admin);
select public.staff_requeue_notification((select id from notifications_log where appointment_id=current_setting('app.apt')::uuid and template_name='appointment_rescheduled'));
select 'voltou para a fila: '||status::text||' tentativas='||retry_count from notifications_log where appointment_id=current_setting('app.apt')::uuid and template_name='appointment_rescheduled';
select 'reenviar um que esta na fila: '||t.fails(format($q$select public.staff_requeue_notification(%L)$q$, (select id from notifications_log where appointment_id=current_setting('app.apt')::uuid and template_name='appointment_rescheduled')));
reset role;

\echo '== 6. cancelar limpa a fila'
select t.login(:valde);
select public.cancel_my_appointment(current_setting('app.apt')::uuid, 'teste');
reset role;
select 'fila apos cancelar (0): '||count(*) from notifications_log where appointment_id=current_setting('app.apt')::uuid and status::text='QUEUED';
