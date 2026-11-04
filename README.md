# 🌸 Aesthetiq - Sistema de Agendamento Clínico (Supabase + FastAPI + Next.js)

Sistema de agendamento online de alta performance para clínica de estética com:
- Trava definitiva de concorrência e **prevenção de double-booking** no banco via PostgreSQL `btree_gist` (`EXCLUDE USING gist`);
- **Row Level Security (RLS)** ativo em 100% das tabelas (Clientes só acessam os próprios dados; Staff e Admin gerenciam a clínica);
- Prontuário médico com **anamnese auditada** conforme a **LGPD (Lei 13.709/2018 - Dados Sensíveis de Saúde)**;
- Fila de notificações transacionais com **Meta WhatsApp Cloud API Oficial** e fallback via e-mail (**Resend**);
- Dashboards com **Recharts** com controle de privacidade (Faturamento financeiro restrito ao Dono/Admin e métricas de autocuidado para o cliente).

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
