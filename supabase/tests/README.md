# Testes do banco (multi-clínica)

Verificam, num Postgres 16 comum, que uma clínica não enxerga nem altera dados de outra, que convites/papéis,
suspensão e agendamento funcionam. Não rodam no Supabase de produção (criam usuários falsos).

```bash
createdb teste
psql teste -f 00_supabase_stub.sql          # simula auth.users, auth.uid(), roles e storage do Supabase
psql teste -f ../migrations/20261104000100_initial_schema.sql
psql teste -f ../migrations/20261116000100_app_integration.sql
psql teste -f 01_seed_legacy.sql            # dados "antigos" de uma clínica única
psql teste -f ../migrations/20261117000100_multi_clinic.sql
psql teste -f multi_clinic_rls_test.sql     # cada linha mostra "BLOCKED..." (esperado) ou o resultado
```
Linhas com `UNEXPECTEDLY-OK` seriam falhas de isolamento (a única exceção esperada é o upload na pasta da
própria clínica, na seção 14, que deve passar).

Depois da migration `20261120000100` (Fase 3), rode `PGTZ=America/Sao_Paulo psql teste -f onboarding_dono_test.sql` num banco recém-criado (modelo, checklist, publicação e travas; cada linha termina em `OK` ou `FALHOU`). Obs.: `multi_clinic_rls_test.sql` foi escrito para o estado pós-migration 3; com a migration 6, a entrada de clientes em clínica fechada é recusada de propósito.

Depois da migration `20261119000100`, rode `psql teste -f intervalo_retorno_test.sql` (limites do intervalo de retorno; só admin altera).

Depois da migration `20261118000100`, rode `PGTZ=America/Sao_Paulo psql teste -f sem_prontuario_agenda_test.sql` (o fuso é necessário: o teste usa horários de Brasília; rode num banco recém-criado, pois ele agenda de verdade) (remarcação, clientes, anamnese removida). Ele traz seus próprios helpers e usa o legado de `01_seed_legacy.sql`.
