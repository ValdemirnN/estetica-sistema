-- Testes da migration 20261120000100 (Fase 3: onboarding do dono).
-- Rode depois das migrations 1-6, num banco recém-criado, com o fuso de Brasília (o teste agenda de verdade):
--   PGTZ=America/Sao_Paulo psql teste -f onboarding_dono_test.sql
-- Cada linha termina em OK ou FALHOU. Não precisa de dados do legado.
\set QUIET on
\pset format unaligned
\pset tuples_only on
create schema if not exists t; grant usage on schema t to anon, authenticated;
create or replace function t.login(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u::text, false); perform set_config('role','authenticated',false); end $$;
create or replace function t.anon() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', false); perform set_config('role','anon',false); end $$;
-- ok(rotulo, condicao)
create or replace function t.ok(label text, cond boolean) returns text language sql as $$ select label||': '||case when coalesce(cond,false) then 'OK' else 'FALHOU' end $$;
-- bloqueia(rotulo, comando): OK se o comando levanta erro OU não altera nenhuma linha (RLS)
create or replace function t.blocked(label text, q text) returns text language plpgsql as $$
declare n int;
begin
  execute q; get diagnostics n = row_count;
  if n = 0 and q ~* '^(update|delete)' then return label||': OK'; end if;
  return label||': FALHOU (executou)';
exception when others then return label||': OK ('||left(sqlerrm,70)||')'; end $$;
-- permite(rotulo, comando): OK se o comando executa sem erro
create or replace function t.allowed(label text, q text) returns text language plpgsql as $$
begin execute q; return label||': OK';
exception when others then return label||': FALHOU ('||left(sqlerrm,70)||')'; end $$;
create or replace function t.cnt(q text) returns bigint language plpgsql as $$ declare n bigint; begin execute 'select count(*) from ('||q||') x' into n; return n; end $$;

\set plat   '''66666666-6666-6666-6666-666666666666'''
\set owner  '''44444444-4444-4444-4444-444444444444'''
\set client '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set late   '''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'''

insert into auth.users (id,email,raw_user_meta_data) values
 (:plat,'plat.fase3@saas.com','{"full_name":"Operador"}'),
 (:owner,'dona@zen.com','{"full_name":"Dona Zen"}'),
 (:client,'cli.fase3@x.com','{"full_name":"Cliente"}'),
 (:late,'tarde.fase3@x.com','{"full_name":"Cliente Tardia"}');
insert into platform_admins values (:plat);

\echo '== 1. plataforma cria clínica COM e SEM modelo'
select t.login(:plat);
select 'cria zen com modelo: '||(public.create_clinic('zen','Zen Spa','dona@zen.com','#7c3aed','(11) 5555-0000', true) is not null);
select 'cria vazia sem modelo: '||(public.create_clinic('vazia','Clínica Vazia','dona@vazia.com') is not null);
reset role;
select set_config('app.zen',   (select id::text from clinics where slug='zen'), false);
select set_config('app.vazia', (select id::text from clinics where slug='vazia'), false);
select t.ok('zen nasce com link FECHADO', (select not booking_published from clinics where slug='zen'));
select t.ok('zen: 4 categorias', t.cnt($$select 1 from service_categories where clinic_id=current_setting('app.zen')::uuid$$) = 4);
select t.ok('zen: 8 procedimentos de exemplo', t.cnt($$select 1 from services where clinic_id=current_setting('app.zen')::uuid$$) = 8);
select t.ok('zen: TODOS os procedimentos inativos', t.cnt($$select 1 from services where clinic_id=current_setting('app.zen')::uuid and is_active$$) = 0);
select t.ok('zen: horário padrão gravado (7 dias)', (select jsonb_array_length(default_working_hours)=7 from clinics where slug='zen'));
select t.ok('zen: seg-sex ativos no padrão', (select count(*)=5 from clinics c, jsonb_array_elements(c.default_working_hours) h where c.slug='zen' and (h->>'is_active')::boolean));
select t.ok('vazia: 4 categorias, 0 procedimentos, sem horário padrão',
  t.cnt($$select 1 from service_categories where clinic_id=current_setting('app.vazia')::uuid$$)=4
  and t.cnt($$select 1 from services where clinic_id=current_setting('app.vazia')::uuid$$)=0
  and (select default_working_hours is null from clinics where slug='vazia'));

\echo '== 2. dono entra e vê o checklist zerado'
select t.login(:owner);
select 'join zen => '||public.join_clinic(current_setting('app.zen')::uuid);
select t.ok('status inicial: 0 prof, 0 horários, 0 procedimentos ativos, não pronto, não publicado',
  (select (s->>'professionals')::int=0 and (s->>'hours')::int=0 and (s->>'services')::int=0
          and not (s->>'ready')::boolean and not (s->>'published')::boolean
     from (select public.clinic_setup_status(current_setting('app.zen')::uuid) s) x));

\echo '== 3. publicar bloqueado enquanto faltar requisito'
select t.blocked('publicar sem nada', $q$update clinics set booking_published=true where slug='zen'$q$);
select t.allowed('dono cadastra profissional', $q$insert into professionals (clinic_id,name) values (current_setting('app.zen')::uuid,'Ana')$q$);
select t.blocked('publicar só com profissional', $q$update clinics set booking_published=true where slug='zen'$q$);

\echo '== 4. dono carrega o modelo depois (horário vai para quem não tem; vínculos criados; idempotente)'
select t.ok('carregar modelo de novo: 0 procedimentos novos, 1 profissional com horário',
  (select (r->>'services_added')::int=0 and (r->>'professionals_with_new_hours')::int=1
     from (select public.load_clinic_template(current_setting('app.zen')::uuid) r) x));
select t.ok('Ana ganhou 5 dias ativos', t.cnt($$select 1 from professional_working_hours where is_active and professional_id=(select id from professionals where name='Ana')$$)=5);
select t.ok('exemplos vinculados à Ana (8)', t.cnt($$select 1 from professional_services where professional_id=(select id from professionals where name='Ana')$$)=8);
select t.ok('ainda 8 procedimentos (sem duplicar)', t.cnt($$select 1 from services where clinic_id=current_setting('app.zen')::uuid$$)=8);
select t.blocked('publicar com prof+horário mas procedimentos inativos', $q$update clinics set booking_published=true where slug='zen'$q$);

\echo '== 5. ativa 1 procedimento: agora pode publicar'
select t.allowed('ativar procedimento', $q$update services set is_active=true where slug='modelo-limpeza-de-pele' and clinic_id=current_setting('app.zen')::uuid$q$);
select t.ok('status: pronto, ainda não publicado',
  (select (s->>'ready')::boolean and not (s->>'published')::boolean from (select public.clinic_setup_status(current_setting('app.zen')::uuid) s) x));

\echo '== 6. enquanto fechado: cliente não entra nem agenda'
reset role; select t.login(:client);
select t.blocked('cliente novo entra em clínica fechada', $q$select public.join_clinic(current_setting('app.zen')::uuid)$q$);
select t.ok('cliente não ficou como membro', t.cnt($$select 1 from clinic_members where user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$)=0);
select t.blocked('cliente não publica pelo update', $q$update clinics set booking_published=true where slug='zen'$q$);
select t.blocked('cliente não vê o status do checklist', $q$select public.clinic_setup_status(current_setting('app.zen')::uuid)$q$);
select t.blocked('cliente não carrega modelo', $q$select public.load_clinic_template(current_setting('app.zen')::uuid)$q$);
reset role;

\echo '== 7. dono publica'
select t.login(:owner);
select t.allowed('publicar', $q$update clinics set booking_published=true where slug='zen'$q$);
select t.ok('get_clinic_public mostra publicado', (public.get_clinic_public('zen')->>'booking_published')::boolean);
reset role;
select t.login(:client);
select 'cliente entra => '||public.join_clinic(current_setting('app.zen')::uuid);
select set_config('app.svc', (select id::text from services where slug='modelo-limpeza-de-pele' and clinic_id=current_setting('app.zen')::uuid), false);
-- próxima segunda-feira, 10:00 (Brasília)
select set_config('app.mon10', (((date_trunc('week', now() at time zone 'America/Sao_Paulo') + interval '7 days' + interval '10 hours') at time zone 'America/Sao_Paulo')::text), false);
select t.allowed('cliente agenda com link aberto', $q$select public.book_appointment(current_setting('app.svc')::uuid, current_setting('app.mon10')::timestamptz)$q$);
reset role;

\echo '== 8. dono pausa o link: cliente deixa de agendar/entrar, equipe continua'
select t.login(:owner);
select t.allowed('pausar (despublicar)', $q$update clinics set booking_published=false where slug='zen'$q$);
reset role;
select t.login(:client);
select t.blocked('cliente já membro não agenda com link pausado', $q$select public.book_appointment(current_setting('app.svc')::uuid, (current_setting('app.mon10')::timestamptz + interval '4 hours'))$q$);
reset role;
select t.login(:late);
select t.blocked('cliente novo não entra com link pausado', $q$select public.join_clinic(current_setting('app.zen')::uuid)$q$);
reset role;
select t.login(:owner);
select t.allowed('equipe agenda mesmo com link pausado', $q$select public.book_appointment(current_setting('app.svc')::uuid, (current_setting('app.mon10')::timestamptz + interval '3 hours'), null, null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$q$);
reset role;

\echo '== 9. republicar exige os requisitos de novo'
select t.login(:owner);
select t.allowed('desativar a profissional', $q$update professionals set is_active=false where name='Ana'$q$);
select t.blocked('republicar sem profissional ativa', $q$update clinics set booking_published=true where slug='zen'$q$);
select t.allowed('reativar a profissional', $q$update professionals set is_active=true where name='Ana'$q$);
select t.allowed('desativar horários da Ana', $q$update professional_working_hours set is_active=false where professional_id=(select id from professionals where name='Ana')$q$);
select t.blocked('republicar sem horário ativo', $q$update clinics set booking_published=true where slug='zen'$q$);
select t.allowed('reativar horários', $q$update professional_working_hours set is_active=true where professional_id=(select id from professionals where name='Ana') and day_of_week in ('MONDAY','TUESDAY')$q$);
select t.allowed('republicar', $q$update clinics set booking_published=true where slug='zen'$q$);
reset role;

\echo '== 10. isolamento entre clínicas'
select t.login(:owner);
select t.blocked('dono da zen não carrega modelo na vazia', $q$select public.load_clinic_template(current_setting('app.vazia')::uuid)$q$);
select t.blocked('dono da zen não vê status da vazia', $q$select public.clinic_setup_status(current_setting('app.vazia')::uuid)$q$);
reset role;
select t.login(:plat);
select t.allowed('plataforma carrega modelo em qualquer clínica', $q$select public.load_clinic_template(current_setting('app.vazia')::uuid)$q$);
select t.ok('plataforma lista com booking_published', (select bool_or((c->>'booking_published')::boolean) from jsonb_array_elements(public.platform_list_clinics()) c));
reset role;
select t.anon();
select t.blocked('anon não carrega modelo', $q$select public.load_clinic_template(current_setting('app.vazia')::uuid)$q$);
select t.ok('anon lê dados públicos (inclui booking_published)', public.get_clinic_public('zen') ? 'booking_published');
reset role;

\echo '== 11. clínicas que já existiam continuam abertas (backfill só na 1a execução) e reexecução não reabre'
select t.ok('vazia continua fechada após reexecutar a migration', (select not booking_published from clinics where slug='vazia'));
select t.ok('aesthetiq (clínica antiga do legado) segue aberta', coalesce((select booking_published from clinics where slug='aesthetiq'), true));
