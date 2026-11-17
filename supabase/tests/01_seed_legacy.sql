insert into auth.users (id,email,raw_user_meta_data) values
 ('11111111-1111-1111-1111-111111111111','admin@aesthetiq.com','{"full_name":"Dona Aesthetiq","phone":"+5511900000001"}'),
 ('22222222-2222-2222-2222-222222222222','cliente@x.com','{"full_name":"Valdemir Nunes","phone":"+5511900000002"}'),
 ('33333333-3333-3333-3333-333333333333','camila@aesthetiq.com','{"full_name":"Dra Camila","phone":"+5511900000003"}');
update profiles set role='ADMIN' where email='admin@aesthetiq.com';
select public.promote_to_professional('camila@aesthetiq.com','Dra. Camila','Biomédica','CRBM 1');
