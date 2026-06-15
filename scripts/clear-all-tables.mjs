/**
 * Limpa todas as tabelas MySQL do projeto (QA).
 *
 * Tabelas: job_executions, access_control_users, mass_type_settings
 *
 * Por padrão só mostra contagens. Use --confirm para executar.
 *
 * Windows:
 *   npm run db:clear-all
 *   npm run db:clear-all -- --confirm
 */
process.env.DATABASE_DRIVER = 'mysql';

await import('../server/loadEnv.js');
const { config } = await import('../server/config.js');
const mysql = (await import('mysql2/promise')).default;

const TABLES = ['job_executions', 'access_control_users', 'mass_type_settings'];

const confirm = process.argv.includes('--confirm');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Uso: npm run db:clear-all [-- --confirm]

Apaga todas as linhas das tabelas MySQL do projeto (não dropa as tabelas).
Requer APP_PROFILE=qa e .env.qa com MYSQL_PASSWORD.

Opções:
  --confirm   Executa o DELETE (sem isso, só mostra contagens)
`);
  process.exit(0);
}

const { host, port, user, password, database } = config.database.mysql;
console.log(`MySQL: ${host}:${port}/${database} (perfil ${config.profile})`);

const conn = await mysql.createConnection({ host, port, user, password, database });

try {
  const counts = {};
  for (const table of TABLES) {
    const [rows] = await conn.execute(`SELECT COUNT(*) AS n FROM ${table}`);
    counts[table] = rows[0]?.n ?? 0;
  }

  console.log('\nLinhas atuais:');
  for (const table of TABLES) {
    console.log(`  ${table}: ${counts[table]}`);
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) {
    console.log('\nNada para apagar.');
    process.exit(0);
  }

  if (!confirm) {
    console.log('\nNada foi apagado. Rode com --confirm para executar.');
    process.exit(0);
  }

  await conn.beginTransaction();
  try {
    for (const table of TABLES) {
      const [result] = await conn.execute(`DELETE FROM ${table}`);
      console.log(`  ${table}: ${result.affectedRows ?? 0} linha(s) apagada(s)`);
    }
    await conn.commit();
    console.log('\nTabelas limpas. Estrutura mantida (CREATE TABLE inalterado).');
  } catch (err) {
    await conn.rollback();
    throw err;
  }
} finally {
  await conn.end();
}
