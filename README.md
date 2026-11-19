# 🌸 Sistema de Agendamento para Clínicas de Estética

**Stack:** Vite + React 19 + TypeScript + Tailwind 4 no front; Supabase (Postgres, Auth, RLS, Storage) no banco; funções serverless da Vercel em `/api`.

Sistema de agendamento online, multi-clínica, com:
- Trava definitiva de concorrência e **prevenção de double-booking** no banco via PostgreSQL `btree_gist` (`EXCLUDE USING gist`);
- **Row Level Security (RLS)** ativo em 100% das tabelas (Clientes só acessam os próprios dados; Staff e Admin gerenciam a clínica);
- **Sem prontuário**: o sistema guarda só o cadastro básico do cliente (nome, contato, CPF/nascimento opcionais) e o agendamento, conforme a **LGPD (Lei 13.709/2018)**; nenhum dado de saúde;
- **Agenda da equipe** por dia/semana/mês, com filtro por profissional, remarcação, repetição semanal, troca de situação e lembrete por WhatsApp;
- Fila de notificações transacionais com **Meta WhatsApp Cloud API Oficial** e fallback via e-mail (**Resend**);
- Dashboards com **Recharts** com controle de privacidade (Faturamento financeiro restrito ao Dono/Admin e, para o cliente, um painel calculado só dos próprios atendimentos: frequência dos últimos 6 meses, mix por categoria e cronograma de retornos definido pelo dono em cada procedimento).

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
   4. `supabase/migrations/20261118000100_sem_prontuario_agenda_clientes.sql` — remove prontuário/anamnese (LGPD) e cria a agenda da equipe e o cadastro de clientes. **Apaga** as tabelas de anamnese: exporte antes se precisar.
   5. `supabase/migrations/20261119000100_intervalo_retorno.sql` — campo "retorno recomendado (dias)" em cada procedimento, usado no cronograma preventivo do cliente.
   6. `supabase/migrations/20261120000100_onboarding_dono.sql` — **Fase 3, onboarding do dono**: "carregar modelo" (categorias, procedimentos de exemplo **inativos** e horários padrão), checklist "Primeiros passos" e **link de agendamento fechado até o dono publicar**. Clínicas que já existiam continuam abertas; as novas nascem fechadas.
2. **Variáveis:** copie `.env.example` para `.env` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (chave **anon**, nunca a `service_role`).
3. **Rodar:** `npm install && npm run dev`.
4. **Você, dono da plataforma** — crie uma conta pelo app e, no SQL Editor:
   ```sql
   insert into public.platform_admins (user_id) select id from public.profiles where email = 'voce@email.com';
   ```
   Depois abra `/?plataforma=1` para criar clínicas.
5. **Criar uma clínica nova** (pelo painel da plataforma, ou por SQL):
   ```sql
   select public.create_clinic('clinica-bella', 'Clínica Bella', 'dona@bella.com', '#7c3aed', '(11) 99999-0000', true);
   ```
   O último argumento (`true`) carrega o **modelo**: procedimentos de exemplo (inativos, o dono edita preço/duração e ativa) e a jornada padrão (seg–sex 09–18, almoço 12–13). No painel da plataforma é a caixa "Carregar modelo" (marcada por padrão). O dono também pode carregar o modelo depois, com o botão no catálogo vazio (`load_clinic_template`, idempotente: não duplica nem sobrescreve).

   A dona cria a conta com esse e-mail, entra em `…?clinica=clinica-bella` e já cai como **administradora**.
   Ela então segue o checklist "Primeiros passos" do painel. **O link de agendamento nasce fechado**: clientes veem "agendamento em breve" e não conseguem se cadastrar nem agendar. O botão **Publicar link de agendamento** só habilita com **ao menos 1 profissional ativo, 1 horário de atendimento ativo e 1 procedimento ativo** — e o próprio banco recusa a publicação se isso não for verdade (não é só o botão). O dono pode **pausar** o link a qualquer momento; a equipe continua usando o painel e agendando normalmente.
6. **Auth:** em produção mantenha *Confirm email* **ligado** (Authentication → Providers → Email): convites de dono/equipe só valem para e-mail confirmado. Adicione as URLs das clínicas em *Authentication → URL Configuration → Redirect URLs* (ou o padrão coringa do seu domínio).

### Como funciona a segurança
- Clientes só leem os **próprios** agendamentos (RLS). Os horários ocupados chegam por `get_busy_slots`, sem dados pessoais.
- Agendar, cancelar e mudar status são funções do banco (`book_appointment`, `cancel_my_appointment`, `update_appointment_status`): preço, duração, jornada, ausências e antecedência mínima são validados lá, e o conflito de horário é garantido pela `EXCLUDE` constraint.
- A equipe remarca por `reschedule_appointment` (mesmas validações de `book_appointment` e mesma trava `EXCLUDE`) e lista clientes por `staff_list_clients`. Observações internas ficam em `clinic_client_notes`, sem acesso direto do navegador.
- Criar a conta de um cliente exige a chave `service_role`, que **nunca** vai ao navegador: isso é feito pela rota serverless `/api/admin/create-client`, que confere se quem chama é ADMIN/RECEPTIONIST da clínica.

### Limitações conhecidas
- Fuso fixo em America/Sao_Paulo para todas as clínicas.
- O envio automático de **WhatsApp** ainda não existe: a fila grava os avisos e `/api/notify/reminders` envia por **e-mail** (Resend); avisos de WhatsApp caem para e-mail quando o cliente aceitou e-mail. A equipe também pode usar o botão “Lembrete” da agenda (abre o WhatsApp com a mensagem pronta).
- O cron padrão em `vercel.json` roda **1x por dia** (limite do plano gratuito da Vercel). Para lembretes mais pontuais, use o plano Pro ou chame a rota a cada 10–15 min por um agendador externo.

---

## 🚀 Como aplicar o banco no Supabase

As migrations ficam em `supabase/migrations` e devem rodar **em ordem** (todas podem ser reexecutadas).

**Opção 1 — SQL Editor (mais rápido para começar):** abra o projeto no [Supabase Dashboard](https://supabase.com/dashboard), vá em *SQL Editor → New query*, cole o conteúdo de cada migration na ordem da lista acima e clique em *Run*.

**Opção 2 — Supabase CLI:**

```bash
npx supabase login
npx supabase link --project-ref seu-project-ref-aqui
npx supabase db push
```

---

## 🗄️ Estrutura das Tabelas Criadas

1. `profiles`: Perfis vinculados automaticamente ao `auth.users` via trigger, com roles (`CLIENT`, `PROFESSIONAL`, `RECEPTIONIST`, `ADMIN`) e termos LGPD.
2. `professionals`: Registro profissional (CRBM/COREN), cor na agenda e **buffer de higienização** pós-atendimento.
3. `service_categories`: Categorias (Facial, Injetáveis, Corporal, Laser).
4. `services`: Procedimentos com duração em minutos, preço em centavos (sem flag de anamnese).
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
9. `clinic_client_notes`: Observação interna da equipe sobre o cliente (sem acesso direto; só por funções).
10. `notifications_log`: Fila de disparo de WhatsApp e E-mail.

---

## 🆕 Sem prontuário + agenda da equipe + cadastro de clientes

**Ordem das migrations** (SQL Editor ou `supabase db push`): `20261104000100` → `20261116000100` → `20261117000100` → **`20261118000100_sem_prontuario_agenda_clientes.sql`**.
A última **apaga** `anamnesis_records`, `anamnesis_access_logs`, as funções de anamnese e a coluna `services.requires_anamnesis`. Exporte antes se precisar das fichas.

**Rotas serverless (`/api`, Vercel):**
| Rota | Para que serve |
|---|---|
| `POST /api/admin/create-client` | Equipe cadastra cliente: cria a conta com senha provisória (o cliente troca no primeiro acesso) e vincula à clínica. |
| `GET/POST /api/notify/reminders` | Worker da fila: envia por e-mail (Resend) o que está `QUEUED`. Exige `Authorization: Bearer $CRON_SECRET`. |

Variáveis só do servidor (Vercel → Environment Variables; veja `.env.example`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`.
Em `npm run dev` as rotas `/api` não existem; use `vercel dev` para testá-las.

**Sobreposição:** o banco não aceita dois atendimentos sobrepostos da mesma profissional (`EXCLUDE`), então não há “encaixe” sobreposto. A duração segue a do procedimento.

**Testes do banco:** `supabase/tests/onboarding_dono_test.sql` (Fase 3) e `supabase/tests/sem_prontuario_agenda_test.sql` (rode depois das migrations, como descrito em `supabase/tests/README.md`).
