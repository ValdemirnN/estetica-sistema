# 🌸 Aesthetiq - Sistema de Agendamento Clínico (Supabase + FastAPI + Next.js)

Sistema de agendamento online de alta performance para clínica de estética com:
- Trava definitiva de concorrência e **prevenção de double-booking** no banco via PostgreSQL `btree_gist` (`EXCLUDE USING gist`);
- **Row Level Security (RLS)** ativo em 100% das tabelas (Clientes só acessam os próprios dados; Staff e Admin gerenciam a clínica);
- Prontuário médico com **anamnese auditada** conforme a **LGPD (Lei 13.709/2018 - Dados Sensíveis de Saúde)**;
- Fila de notificações transacionais com **Meta WhatsApp Cloud API Oficial** e fallback via e-mail (**Resend**);
- Dashboards com **Recharts** com controle de privacidade (Faturamento financeiro restrito ao Dono/Admin e métricas de autocuidado para o cliente).

---

## 🏢 Multi-clínica: um sistema, várias clínicas independentes

Cada clínica que aluga o sistema tem **seu próprio espaço**: endereço (slug), marca (nome, logo, cor, textos), procedimentos,
profissionais, horários, clientes e agenda — totalmente isolados no banco (RLS + chaves compostas).

| Quem | O que faz |
|---|---|
| **Plataforma** (você, que aluga o sistema) | Cria/suspende clínicas em `/?plataforma=1` (ou por SQL). Não vê dados de clientes das clínicas. |
| **Dono(a) da clínica** (`ADMIN`) | No painel: cadastra/edita **procedimentos** (nome, descrição, preço, duração, foto, categoria), **profissionais**, **jornada semanal e folgas/bloqueios**, personaliza **logo/cor/textos/regras** e gerencia a **equipe**. |
| Recepção / Profissional | Agenda, status e fichas da própria clínica. |
| Cliente | Agenda pelo link da clínica. A mesma conta pode ser cliente em várias clínicas. |

### Como a clínica é identificada
`https://app.com/?clinica=bella` · `https://app.com/c/bella` · ou subdomínio `https://bella.seudominio.com.br`
(defina `VITE_BASE_DOMAIN` e aponte um domínio coringa `*.seudominio.com.br` para o projeto na Vercel).
Para uma instalação de uma clínica só, use `VITE_DEFAULT_CLINIC_SLUG`.

## ⚙️ Configuração (tudo roda no Supabase, sem dados locais)

1. **Banco:** no *SQL Editor*, rode **nesta ordem** (todas podem ser reexecutadas):
   1. `supabase/migrations/20261104000100_initial_schema.sql`
   2. `supabase/migrations/20261116000100_app_integration.sql`
   3. `supabase/migrations/20261117000100_multi_clinic.sql` — multi-clínica. Se você já tinha a clínica única funcionando, ela vira a clínica `aesthetiq`, com todos os dados e papéis preservados. Também cria o bucket de imagens `clinic-assets`.
2. **Variáveis:** copie `.env.example` para `.env` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (chave **anon**, nunca a `service_role`).
3. **Rodar:** `npm install && npm run dev`.
4. **Você, dono da plataforma** — crie uma conta pelo app e, no SQL Editor:
   ```sql
   insert into public.platform_admins (user_id) select id from public.profiles where email = 'voce@email.com';
   ```
   Depois abra `/?plataforma=1` para criar clínicas.
5. **Criar uma clínica nova** (pelo painel da plataforma, ou por SQL):
   ```sql
   select public.create_clinic('clinica-bella', 'Clínica Bella', 'dona@bella.com', '#7c3aed', '(11) 99999-0000');
   ```
   A dona cria a conta com esse e-mail, entra em `…?clinica=clinica-bella` e já cai como **administradora**.
   Ela então segue o checklist "Primeiros passos" do painel: profissionais → horários → procedimentos → marca.
6. **Auth:** em produção mantenha *Confirm email* **ligado** (Authentication → Providers → Email): convites de dono/equipe só valem para e-mail confirmado. Adicione as URLs das clínicas em *Authentication → URL Configuration → Redirect URLs* (ou o padrão coringa do seu domínio).

### Como funciona a segurança
- Clientes só leem os **próprios** agendamentos e anamnese (RLS). Os horários ocupados chegam por `get_busy_slots`, sem dados pessoais.
- Agendar, cancelar e mudar status são funções do banco (`book_appointment`, `cancel_my_appointment`, `update_appointment_status`): preço, duração, jornada, ausências e antecedência mínima são validados lá, e o conflito de horário é garantido pela `EXCLUDE` constraint.
- A equipe abre a anamnese por `staff_view_anamnesis`, que **registra o acesso** no log de auditoria automaticamente.

### Limitações conhecidas
- Fuso fixo em America/Sao_Paulo para todas as clínicas.
- A tela "Meu Dashboard" do cliente ainda mostra dados ilustrativos (gráficos e "Nível Gold VIP"), herdados do protótipo.
- `supabase_schema.sql` na raiz é o schema inicial antigo (sem multi-clínica); use as migrations.
- As notificações são **gravadas na fila** (`notifications_log`), mas nada as envia ainda: falta um worker (ex.: Edge Function agendada) ligado ao WhatsApp Cloud API / Resend.

---

## 🚀 Como Rodar o Banco de Dados no Supabase

Você tem **duas formas simples** de rodar o arquivo no seu Supabase:

### Opção 1: Direto no Painel do Supabase (1 Minuto - Recomendado para começar)
1. Acesse o seu projeto no [Supabase Dashboard](https://supabase.com/dashboard).
2. No menu lateral esquerdo, clique no ícone **SQL Editor**.
3. Clique em **"New query"** (Nova consulta).
4. Abra o arquivo `supabase_schema.sql` (ou `supabase/migrations/20261104000100_initial_schema.sql`), copie todo o conteúdo e cole no editor.
5. Clique no botão verde **"Run"** (no canto inferior direito ou aperte `Ctrl + Enter` / `Cmd + Enter`).
6. **Pronto!** Todas as tabelas, enums, triggers, índices, RLS e dados de teste estarão criados.

---

### Opção 2: Pelo GitHub com a Supabase CLI (Pipeline de CI/CD para Produção)
Se você estiver versionando o projeto no GitHub com a Supabase CLI:

```bash
# 1. Instale ou atualize a CLI do Supabase
npm install supabase --save-dev

# 2. Faça o login na sua conta Supabase
npx supabase login

# 3. Vincule o repositório local ao seu projeto do Supabase (substitua pelo seu Reference ID)
npx supabase link --project-ref seu-project-ref-aqui

# 4. Aplique a migration diretamente no banco de produção
npx supabase db push
```

---

## 🗄️ Estrutura das Tabelas Criadas

1. `profiles`: Perfis vinculados automaticamente ao `auth.users` via trigger, com roles (`CLIENT`, `PROFESSIONAL`, `RECEPTIONIST`, `ADMIN`) e termos LGPD.
2. `professionals`: Registro profissional (CRBM/COREN), cor na agenda e **buffer de higienização** pós-atendimento.
3. `service_categories`: Categorias (Facial, Injetáveis, Corporal, Laser).
4. `services`: Procedimentos com duração em minutos, preço em centavos e flag se exige anamnese.
5. `professional_services`: Vínculo N:N de especialidades.
6. `professional_working_hours`: Jornada de trabalho semanal e horário de almoço.
7. `professional_leaves`: Ausências, atestados e férias que bloqueiam a grade.
8. `appointments`: **Tabela central de agendamento** com a constraint:
   ```sql
   CONSTRAINT prevent_professional_double_booking EXCLUDE USING gist (
       professional_id WITH =,
       tsrange(start_time, buffer_end_time, '[)') WITH &&
   ) WHERE (status IN ('PENDING', 'CONFIRMED'))
   ```
9. `anamnesis_records`: Ficha de saúde com alergias, medicamentos, gestação e marcapasso.
10. `anamnesis_access_logs`: Trilha de auditoria obrigatória da LGPD (quem acessou, quando, IP e ação).
11. `notifications_log`: Fila de disparo de WhatsApp e E-mail.
