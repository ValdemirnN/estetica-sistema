-- Testes da migration 20261123000100 (Fase 6). Rode num banco recém-criado, depois das migrations 1-9
-- e de 01_seed_legacy.sql:  PGTZ=America/Sao_Paulo psql teste -f gestao_dono_test.sql
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
select set_config('app.pro', (select id::text from professionals where name='Dra. Camila'), false);
select set_config('app.svc', (select id::text from services where clinic_id=current_setting('app.aes')::uuid and is_active order by name limit 1), false);

\echo '== 1. comissao: so o ADMIN da clinica'
select t.login(:valde);
select 'cliente lista comissoes: '||t.fails($q$select * from public.admin_list_commissions(current_setting('app.aes')::uuid)$q$);
select 'cliente define comissao: '||t.fails($q$select public.admin_set_commission(current_setting('app.aes')::uuid, current_setting('app.pro')::uuid, 10)$q$);
select 'cliente le a tabela direto: '||t.fails($q$select * from public.professional_commissions$q$);
reset role;
select t.login(:camila);
select 'profissional (nao admin) lista comissoes: '||t.fails($q$select * from public.admin_list_commissions(current_setting('app.aes')::uuid)$q$);
select 'profissional define a propria comissao: '||t.fails($q$select public.admin_set_commission(current_setting('app.aes')::uuid, current_setting('app.pro')::uuid, 90)$q$);
reset role;
select t.login(:admin);
select 'admin sem comissao definida (0 linhas): '||count(*) from public.admin_list_commissions(current_setting('app.aes')::uuid);
select public.admin_set_commission(current_setting('app.aes')::uuid, current_setting('app.pro')::uuid, 30.5);
select 'admin define 30,5%: '||commission_pct from public.admin_list_commissions(current_setting('app.aes')::uuid);
select public.admin_set_commission(current_setting('app.aes')::uuid, current_setting('app.pro')::uuid, 25);
select 'admin altera para 25 (continua 1 linha): '||count(*)||' / '||max(commission_pct) from public.admin_list_commissions(current_setting('app.aes')::uuid);
select 'acima de 100: '||t.fails($q$select public.admin_set_commission(current_setting('app.aes')::uuid, current_setting('app.pro')::uuid, 100.01)$q$);
select 'negativa: '||t.fails($q$select public.admin_set_commission(current_setting('app.aes')::uuid, current_setting('app.pro')::uuid, -1)$q$);
select 'nula: '||t.fails($q$select public.admin_set_commission(current_setting('app.aes')::uuid, current_setting('app.pro')::uuid, null)$q$);
select 'profissional inexistente: '||t.fails($q$select public.admin_set_commission(current_setting('app.aes')::uuid, gen_random_uuid(), 10)$q$);
reset role;

\echo '== 2. lista de espera: so a equipe'
select t.login(:valde);
select 'cliente lista a espera (esperado 0): '||count(*) from public.staff_list_waitlist(current_setting('app.aes')::uuid);
select 'cliente se coloca na espera: '||t.fails($q$select public.staff_add_waitlist(current_setting('app.aes')::uuid, '22222222-2222-2222-2222-222222222222', current_setting('app.svc')::uuid)$q$);
select 'cliente le a tabela direto: '||t.fails($q$select * from public.waitlist_entries$q$);
reset role;

select t.login(:camila);
select set_config('app.w1', public.staff_add_waitlist(current_setting('app.aes')::uuid, '22222222-2222-2222-2222-222222222222', current_setting('app.svc')::uuid, current_setting('app.pro')::uuid, current_date + 3, current_date + 10, 'MORNING', 'prefere cedo')::text, false);
select 'equipe adicionou: '||(current_setting('app.w1') is not null);
select 'duplicado em aberto: '||t.fails($q$select public.staff_add_waitlist(current_setting('app.aes')::uuid, '22222222-2222-2222-2222-222222222222', current_setting('app.svc')::uuid)$q$);
select 'periodo invalido: '||t.fails($q$select public.staff_add_waitlist(current_setting('app.aes')::uuid, '22222222-2222-2222-2222-222222222222', current_setting('app.svc')::uuid, null, null, null, 'MADRUGADA')$q$);
select 'datas invertidas: '||t.fails($q$select public.staff_add_waitlist(current_setting('app.aes')::uuid, '22222222-2222-2222-2222-222222222222', current_setting('app.svc')::uuid, null, current_date + 5, current_date + 1)$q$);
select 'cliente que nao e da clinica: '||t.fails($q$select public.staff_add_waitlist(current_setting('app.aes')::uuid, gen_random_uuid(), current_setting('app.svc')::uuid)$q$);
select 'procedimento de outra clinica/inexistente: '||t.fails($q$select public.staff_add_waitlist(current_setting('app.aes')::uuid, '22222222-2222-2222-2222-222222222222', gen_random_uuid())$q$);
select 'lista mostra 1 com nomes: '||count(*)||' / '||max(client_name)||' / '||max(professional_name)||' / '||max(period) from public.staff_list_waitlist(current_setting('app.aes')::uuid);

\echo '== 3. andamento do pedido'
select public.staff_set_waitlist_status(current_setting('app.aes')::uuid, current_setting('app.w1')::uuid, 'CONTACTED');
select 'contatado continua na lista: '||count(*)||' / '||max(status) from public.staff_list_waitlist(current_setting('app.aes')::uuid);
select 'situacao invalida: '||t.fails(format($q$select public.staff_set_waitlist_status(current_setting('app.aes')::uuid, %L, 'XPTO')$q$, current_setting('app.w1')));
select 'pedido inexistente: '||t.fails($q$select public.staff_set_waitlist_status(current_setting('app.aes')::uuid, gen_random_uuid(), 'BOOKED')$q$);
select public.staff_set_waitlist_status(current_setting('app.aes')::uuid, current_setting('app.w1')::uuid, 'BOOKED');
select 'agendado sai da lista (0): '||count(*) from public.staff_list_waitlist(current_setting('app.aes')::uuid);
reset role;
select 'resolved_at preenchido ao agendar: '||(resolved_at is not null) from waitlist_entries where id=current_setting('app.w1')::uuid;
select t.login(:camila);
select 'depois de resolvido, pode entrar de novo: '||(public.staff_add_waitlist(current_setting('app.aes')::uuid, '22222222-2222-2222-2222-222222222222', current_setting('app.svc')::uuid) is not null);
reset role;
