// Junta supabase/migrations/*.sql (em ordem) em supabase/supabase_tudo.sql, para colar de uma vez
// no Supabase → SQL Editor. Uso: node scripts/build-supabase-sql.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'supabase/migrations';
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

// Os seeds das migrations 1 e 2 (modelo de clínica única) quebram numa 2ª execução, depois que a
// migration 3 torna clinic_id obrigatório. No arquivo único eles só rodam enquanto a tabela
// `clinics` ainda não existe (banco novo, antes da multi-clínica).
const SEED = /^INSERT INTO public\.(service_categories|services|clinic_settings)\b[\s\S]*?ON CONFLICT[^;]*;/gm;
const guard = (sql) =>
  sql.replace(
    SEED,
    (m) => `DO $seed$ BEGIN IF to_regclass('public.clinics') IS NULL THEN\n${m}\nEND IF; END $seed$;`,
  );

let out = `-- ==============================================================================
-- SUPABASE — ARQUIVO ÚNICO (todas as migrations, na ordem)
-- Cole tudo em: Supabase Dashboard → SQL Editor → New query → Run.
-- Pode ser reexecutado sem problemas (banco novo ou já migrado).
-- GERADO por scripts/build-supabase-sql.mjs a partir de supabase/migrations/*.sql — não edite à mão.
-- ==============================================================================

`;
for (const f of files) {
  let sql = readFileSync(join(dir, f), 'utf8');
  if (f < '20261117') sql = guard(sql);
  out += `-- ##############################################################################\n-- MIGRATION: ${f}\n-- ##############################################################################\n\n${sql.trimEnd()}\n\n`;
}
writeFileSync('supabase/supabase_tudo.sql', out);
console.log(`supabase/supabase_tudo.sql ← ${files.length} migrations`);
