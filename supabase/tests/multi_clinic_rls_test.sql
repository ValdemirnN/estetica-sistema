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
\set owner  '''44444444-4444-4444-4444-444444444444'''
\set stranger '''55555555-5555-5555-5555-555555555555'''
\set plat '''66666666-6666-6666-6666-666666666666'''

\echo '== 1. legado migrado'
select 'clinics: '||count(*) from clinics;
select 'members aesthetiq: '||string_agg(role::text, ',' order by role) from clinic_members;
select 'appointment clinic_id preenchido: '||bool_and(clinic_id is not null) from appointments;
select 'professionals ativos: '||count(*) from professionals where is_active;

-- usuários novos
insert into auth.users (id,email,raw_user_meta_data) values
 (:owner,'owner@bella.com','{"full_name":"Dona Bella"}'),
 (:stranger,'stranger@x.com','{"full_name":"Estranha"}'),
 (:plat,'plat@saas.com','{"full_name":"Operador"}');
insert into platform_admins values (:plat);

\echo '== 2. plataforma cria clínica'
select t.login(:valde);
select 'cliente comum criando clinica: '||t.fails($q$select public.create_clinic('hack','Hack','a@b.com')$q$);
reset role;
select t.login(:plat);
select 'plat cria bella: '||(select public.create_clinic('bella','Clínica Bella','owner@bella.com','#7c3aed','(11) 5555-0000') is not null);
select 'slug reservado: '||t.fails($q$select public.create_clinic('admin','X','a@b.com')$q$);
select 'slug duplicado: '||t.fails($q$select public.create_clinic('bella','X','a@b.com')$q$);
select 'plat lista: '||jsonb_array_length(public.platform_list_clinics());
reset role;
select 'convite pendente criado: '||count(*) from clinic_invites where email='owner@bella.com' and role='ADMIN';

\echo '== 3. dono entra e vira ADMIN via convite'
select set_config('app.bella', (select id::text from clinics where slug='bella'), false);
select set_config('app.aes', (select id::text from clinics where slug='aesthetiq'), false);
select t.login(:owner);
select 'get_clinic_public (anon-like): '||(public.get_clinic_public('bella')->>'name');
select 'join_clinic => '||public.join_clinic(current_setting('app.bella')::uuid);
select 'owner enxerga 1 clinica (a dele): '||t.cnt('select 1 from clinics');
select 'owner NÃO vê clinica aesthetiq: '||t.cnt($$select 1 from clinics where slug='aesthetiq'$$);
select 'owner join aesthetiq vira CLIENT: '||public.join_clinic(current_setting('app.aes')::uuid);

\echo '== 4. dono gerencia catálogo na bella'
select 'owner vê categorias iniciais bella: '||t.cnt($$select 1 from service_categories where clinic_id=current_setting('app.bella')::uuid$$);
insert into service_categories (clinic_id,name,slug,display_order) values (current_setting('app.bella')::uuid,'Spa Day','spa-day',9);
insert into services (clinic_id,category_id,name,slug,description,duration_minutes,price_cents)
 select clinic_id,id,'Day Spa Completo','day-spa-x1','Dia de spa',90,45000 from service_categories where slug='spa-day' and clinic_id=current_setting('app.bella')::uuid;
insert into professionals (clinic_id,name,title,registry_number,color_hex) values (current_setting('app.bella')::uuid,'Ana Souza','Esteticista','CRE 1','#7c3aed');
insert into professional_services (clinic_id,professional_id,service_id)
 select p.clinic_id,p.id,s.id from professionals p, services s where p.name='Ana Souza' and s.slug='day-spa-x1';
insert into professional_working_hours (clinic_id,professional_id,day_of_week,start_time,end_time,break_start_time,break_end_time,is_active)
 select p.clinic_id,p.id,d::day_of_week,'08:00','18:00','12:00','13:00',true from professionals p, unnest(array['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY']) d where p.name='Ana Souza';
select 'owner criou serviço+profissional+jornada: ok';

\echo '== 5. ISOLAMENTO: dono da bella tentando mexer na aesthetiq'
select 'inserir categoria na aesthetiq: '||t.fails($q$insert into service_categories (clinic_id,name,slug) values (current_setting('app.aes')::uuid,'Invasao','invasao')$q$);
select 'update preço serviço aesthetiq: '||t.fails($q$update services set price_cents=1 where clinic_id=current_setting('app.aes')::uuid$q$);
select 'delete serviço aesthetiq: '||t.fails($q$delete from services where clinic_id=current_setting('app.aes')::uuid$q$);
select 'update nome clínica aesthetiq: '||t.fails($q$update clinics set name='Hacked' where slug='aesthetiq'$q$);
select 'ler agendamentos aesthetiq: '||t.cnt($$select 1 from appointments where clinic_id=current_setting('app.aes')::uuid$$);
select 'ler membros aesthetiq: '||t.cnt($$select 1 from clinic_members where clinic_id=current_setting('app.aes')::uuid$$);
select 'ver perfil do cliente Valdemir (só é cliente dele em outra): '||t.cnt($$select 1 from profiles where email='cliente@x.com'$$);
select 'serviço com categoria de OUTRA clínica (FK composta): '||t.fails($q$insert into services (clinic_id,category_id,name,slug,duration_minutes,price_cents) select current_setting('app.bella')::uuid,id,'X','x-1',10,100 from service_categories where clinic_id=current_setting('app.aes')::uuid limit 1$q$);
select 'vincular prof bella a serviço aesthetiq: '||t.fails($q$insert into professional_services (clinic_id,professional_id,service_id) select current_setting('app.bella')::uuid,(select id from professionals where name='Ana Souza'),id from services where clinic_id=current_setting('app.aes')::uuid limit 1$q$);
select 'owner muda slug: '||t.fails($q$update clinics set slug='outro' where slug='bella'$q$);
select 'owner suspende a si mesmo (is_active): '||t.fails($q$update clinics set is_active=false where slug='bella'$q$);
update clinics set tagline='Beleza que cuida', primary_color='#0ea5e9', slot_step_minutes=30 where slug='bella';
select 'owner edita marca: '||(select tagline||' '||primary_color||' '||slot_step_minutes from clinics where slug='bella');
select 'cor invalida: '||t.fails($q$update clinics set primary_color='red' where slug='bella'$q$);

\echo '== 6. cliente Valdemir agenda na bella'
reset role;
select t.login(:valde);
select 'valde join bella: '||public.join_clinic(current_setting('app.bella')::uuid);
select 'valde vê serviços bella: '||t.cnt($$select 1 from services where clinic_id=current_setting('app.bella')::uuid$$);
select 'valde NÃO consegue criar serviço: '||t.fails($q$insert into services (clinic_id,category_id,name,slug,duration_minutes,price_cents) select clinic_id,id,'x','x-2',10,1 from service_categories where clinic_id=current_setting('app.bella')::uuid limit 1$q$);
select 'valde NÃO atualiza clínica: '||t.fails($q$update clinics set name='x' where slug='bella'$q$);
select 'valde NÃO se promove (membros): '||t.fails($q$update clinic_members set role='ADMIN' where user_id=auth.uid()$q$);
select 'valde NÃO insere em membros: '||t.fails($q$insert into clinic_members (clinic_id,user_id,role) values (current_setting('app.bella')::uuid, auth.uid(), 'ADMIN')$q$);
select 'valde NÃO lê convites: '||t.cnt('select 1 from clinic_invites');
select 'valde NÃO usa invite_member: '||t.fails($q$select public.invite_member(current_setting('app.bella')::uuid,'x@y.com','ADMIN')$q$);
select 'valde NÃO é platform: '||public.is_platform_admin();
-- agendar: próximo dia útil 10h (America/Sao_Paulo) ~ usa uma segunda-feira futura
select set_config('app.start', (select (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '10 days' + interval '10 hours')::text||'-03' from (select 1) z), false);
select set_config('app.svc', (select id::text from services where slug='day-spa-x1'), false);
select 'book OK: '||(public.book_appointment(current_setting('app.svc')::uuid, current_setting('app.start')::timestamptz)) is not null;
select 'book conflito (mesmo horário): '||t.fails($q$select public.book_appointment(current_setting('app.svc')::uuid, current_setting('app.start')::timestamptz)$q$);
select 'book fora da jornada (22h): '||t.fails($q$select public.book_appointment(current_setting('app.svc')::uuid, (current_setting('app.start')::timestamptz + interval '12 hours'))$q$);
select 'valde vê 1 agendamento bella: '||t.cnt($$select 1 from appointments where clinic_id=current_setting('app.bella')::uuid$$);
select 'busy slots bella: '||t.cnt($$select 1 from public.get_busy_slots(current_setting('app.bella')::uuid, now(), now()+interval '60 days')$$);
select 'busy slots aesthetiq (membro) ok: '||t.cnt($$select 1 from public.get_busy_slots(current_setting('app.aes')::uuid, now(), now()+interval '60 days')$$);
select 'cliente altera status: '||t.fails($q$select public.update_appointment_status((select id from appointments where clinic_id=current_setting('app.bella')::uuid limit 1),'COMPLETED')$q$);
select 'cliente update direto appointment: '||t.fails($q$update appointments set total_price_cents=0$q$);
-- anamnese por clínica
insert into anamnesis_records (clinic_id,client_id,allergies,signature_consent) values (current_setting('app.bella')::uuid, auth.uid(), 'latex', true);
select 'anamnese bella e aesthetiq independentes: '||t.cnt($$select 1 from anamnesis_records$$);
select 'anamnese em clínica onde não é membro: '||t.fails($q$insert into anamnesis_records (clinic_id,client_id) values (gen_random_uuid(), auth.uid())$q$);

\echo '== 7. estranho (não membro da bella)'
reset role;
select t.login(:stranger);
select 'estranho book na bella: '||t.fails($q$select public.book_appointment(current_setting('app.svc')::uuid, current_setting('app.start')::timestamptz + interval '1 hour')$q$);
select 'estranho vê serviços bella: '||t.cnt($$select 1 from services where clinic_id=current_setting('app.bella')::uuid$$);
select 'estranho vê perfis alheios: '||t.cnt($$select 1 from profiles where id<>auth.uid()$$);
select 'estranho busy slots bella: '||t.cnt($$select 1 from public.get_busy_slots(current_setting('app.bella')::uuid, now(), now()+interval '60 days')$$);
select 'estranho join clinica inexistente: '||t.fails($q$select public.join_clinic(gen_random_uuid())$q$);
select 'estranho get_clinic_public (login page) ok: '||(public.get_clinic_public('bella')->>'name');

\echo '== 8. dono da bella vê dados da bella (perfis dos clientes, anamnese via RPC auditada)'
reset role;
select t.login(:owner);
select 'owner vê perfil Valdemir agora (é cliente da bella): '||t.cnt($$select 1 from profiles where email='cliente@x.com'$$);
select 'owner vê agendamentos bella: '||t.cnt($$select 1 from appointments$$);
select 'owner abre anamnese bella: '||(public.staff_view_anamnesis(current_setting('app.bella')::uuid, :valde)->>'allergies');
select 'owner anamnese direta (sem RPC): '||t.cnt($$select 1 from anamnesis_records$$);
select 'log de acesso registrado: '||t.cnt($$select 1 from anamnesis_access_logs$$);
select 'owner tenta abrir anamnese aesthetiq: '||t.fails($q$select public.staff_view_anamnesis(current_setting('app.aes')::uuid, '22222222-2222-2222-2222-222222222222')$q$);
select 'owner muda status: '||(select public.update_appointment_status(id,'COMPLETED','ok') is null from appointments limit 1);
select 'historico de status (2 linhas): '||t.cnt($$select 1 from appointment_status_history$$);
select 'owner tenta mudar status de agendamento aesthetiq: '||t.fails($q$select public.update_appointment_status((select id from appointments where clinic_id=current_setting('app.aes')::uuid limit 1),'COMPLETED')$q$);
reset role;
select 'status do agendamento aesthetiq intacto: '||status from appointments where clinic_id=current_setting('app.aes')::uuid;

\echo '== 9. equipe: convite e last-admin'
select t.login(:owner);
select 'convite recepção (sem conta): '||public.invite_member(current_setting('app.bella')::uuid,'recep@bella.com','RECEPTIONIST');
select 'dar RECEPTIONIST ao Valdemir (tem conta): '||public.invite_member(current_setting('app.bella')::uuid,'cliente@x.com','RECEPTIONIST');
select 'rebaixar único admin: '||t.fails($q$select public.invite_member(current_setting('app.bella')::uuid,'owner@bella.com','RECEPTIONIST')$q$);
select 'set_member_access único admin: '||t.fails($q$select public.set_member_access(current_setting('app.bella')::uuid, auth.uid(), 'CLIENT', true)$q$);
select 'invite_member na aesthetiq: '||t.fails($q$select public.invite_member(current_setting('app.aes')::uuid,'z@z.com','ADMIN')$q$);
reset role;
select t.login(:valde);
select 'valde agora RECEPTIONIST vê agenda bella: '||t.cnt($$select 1 from appointments where clinic_id=current_setting('app.bella')::uuid$$);
select 'recepcionista NÃO edita serviços: '||t.fails($q$update services set price_cents=1 where clinic_id=current_setting('app.bella')::uuid$q$);

\echo '== 10. admin legado da aesthetiq continua dono lá'
reset role;
select t.login(:admin);
select 'admin aesthetiq role: '||public.join_clinic(current_setting('app.aes')::uuid);
with u as (update services set price_cents=price_cents where clinic_id=current_setting('app.aes')::uuid returning 1) select 'admin aesthetiq edita preço (linhas): '||count(*) from u;
select 'admin aesthetiq NÃO vê bella: '||t.cnt($$select 1 from services where clinic_id=current_setting('app.bella')::uuid$$);
select 'admin aesthetiq NÃO vê agenda bella: '||t.cnt($$select 1 from appointments where clinic_id=current_setting('app.bella')::uuid$$);

\echo '== 11. suspensão'
reset role;
select set_config('request.jwt.claim.sub','',false);
update clinics set is_active=false where slug='bella';
select t.login(:owner);
select 'owner na clinica suspensa lê clinics: '||t.cnt($$select 1 from clinics where slug='bella'$$);
select 'join clinica suspensa: '||t.fails($q$select public.join_clinic(current_setting('app.bella')::uuid)$q$);
select 'public flag is_active: '||(public.get_clinic_public('bella')->>'is_active');
reset role;
select t.login(:valde);
select 'cliente book clinica suspensa: '||t.fails($q$select public.book_appointment(current_setting('app.svc')::uuid, current_setting('app.start')::timestamptz + interval '2 hours')$q$);
reset role;
select t.login(:plat);
with u as (update clinics set is_active=true where slug='bella' returning 1) select 'plataforma reativa (linhas): '||count(*) from u;

\echo '== 11b. convite para quem ainda NÃO tem conta (dono novo)'
reset role;
select set_config('request.jwt.claim.sub','',false);
select 'cria clinica p/ e-mail sem conta: '||(public.create_clinic('zen','Zen Spa','novo@zen.com') is not null);
select set_config('app.zen', (select id::text from clinics where slug='zen'), false);
select 'convite pendente: '||count(*) from clinic_invites where email='novo@zen.com';
insert into auth.users (id,email,raw_user_meta_data,email_confirmed_at) values ('77777777-7777-7777-7777-777777777777','NOVO@zen.com','{"full_name":"Novo Dono"}',now());
select t.login('77777777-7777-7777-7777-777777777777');
select 'novo dono (e-mail confirmado) join zen => '||public.join_clinic(current_setting('app.zen')::uuid);
select 'convite consumido: '||(select count(*) from (select 1 from clinic_invites where email='novo@zen.com') x);
reset role;
select set_config('request.jwt.claim.sub','',false);
select public.create_clinic('zen2','Zen 2','sneak@zen.com') is not null;
select set_config('app.zen2', (select id::text from clinics where slug='zen2'), false);
insert into auth.users (id,email,raw_user_meta_data,email_confirmed_at) values ('88888888-8888-8888-8888-888888888888','sneak@zen.com','{}',null);
select t.login('88888888-8888-8888-8888-888888888888');
select 'e-mail NÃO confirmado tenta usar convite ADMIN => '||public.join_clinic(current_setting('app.zen2')::uuid);
reset role;

\echo '== 12. anon'
reset role;
select t.anon();
select 'anon get_clinic_public: '||(public.get_clinic_public('aesthetiq')->>'name');
select 'anon lê clinics: '||t.fails('select 1 from clinics');
select 'anon lê services: '||t.fails('select 1 from services');
select 'anon rpc join: '||t.fails($q$select public.join_clinic(current_setting('app.aes')::uuid)$q$);
select 'anon create_clinic: '||t.fails($q$select public.create_clinic('zzz','Z','a@b.com')$q$);
select 'anon platform_admins: '||t.fails('select 1 from platform_admins');
reset role;

\echo '== 13. deletar serviço com agendamento (RESTRICT) e profissional sem login'
select t.login(:owner);
select 'delete serviço com agendamento: '||t.fails($q$delete from services where slug='day-spa-x1'$q$);
select 'delete prof com agendamento: '||t.fails($q$delete from professionals where name='Ana Souza'$q$);
with u as (update services set is_active=false where slug='day-spa-x1' returning 1) select 'desativar serviço (linhas): '||count(*) from u;
select 'book serviço inativo: '||t.fails($q$select public.book_appointment(current_setting('app.svc')::uuid, current_setting('app.start')::timestamptz + interval '3 hours')$q$);
reset role;

\echo '== 14. storage'
select t.login(:owner);
select 'upload na pasta da bella: '||t.fails(format($q$insert into storage.objects (bucket_id,name) values ('clinic-assets','%s/logo.png')$q$, current_setting('app.bella')));
select 'upload na pasta da aesthetiq: '||t.fails(format($q$insert into storage.objects (bucket_id,name) values ('clinic-assets','%s/logo.png')$q$, current_setting('app.aes')));
select 'upload pasta lixo: '||t.fails($q$insert into storage.objects (bucket_id,name) values ('clinic-assets','nao-uuid/logo.png')$q$);
reset role;
