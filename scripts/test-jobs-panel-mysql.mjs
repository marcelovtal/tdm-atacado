/**
 * Testa as queries exatas do GET /api/jobs contra o MySQL QA.
 * Uso: cross-env APP_PROFILE=qa node scripts/test-jobs-panel-mysql.mjs
 */
process.env.DATABASE_DRIVER = 'mysql';

await import('../server/loadEnv.js');
const { initMysqlDatabase, listJobExecutionsForJobsPanelMysql, listJobExecutionOwnersForPanelMysql } =
  await import('../server/database/mysqlStore.js');
const { config } = await import('../server/config.js');

console.log('MySQL:', `${config.database.mysql.host}/${config.database.mysql.database}`);

await initMysqlDatabase();

// Admin sem filtro (VT422570)
console.log('\n1. listJobExecutionsForJobsPanel (admin, 30d)...');
const rows = await listJobExecutionsForJobsPanelMysql({ userCode: null, days: 30, limit: 500 });
console.log(`   OK — ${rows.length} linha(s)`);
if (rows[0]) {
  console.log('   Exemplo:', rows[0].id, rows[0].mass_type_label, rows[0].user_code);
}

console.log('\n2. listJobExecutionOwnersForPanel (30d)...');
const owners = await listJobExecutionOwnersForPanelMysql({ days: 30 });
console.log(`   OK — ${owners.length} VT(s):`, owners.slice(0, 5).join(', '));

console.log('\n3. Simula query ANTIGA (LIMIT ? + INTERVAL ?) — deve falhar:');
const mysql = (await import('mysql2/promise')).default;
const { host, port, user, password, database } = config.database.mysql;
const conn = await mysql.createConnection({ host, port, user, password, database });
try {
  await conn.execute(
    `SELECT id FROM job_executions WHERE executed_at >= DATE_SUB(NOW(), INTERVAL ? DAY) LIMIT ?`,
    [30, 10],
  );
  console.log('   Query antiga: OK (inesperado)');
} catch (e) {
  console.log('   Query antiga: FALHA —', e.message);
}
await conn.end();

console.log('\nTudo certo com o código novo.');
