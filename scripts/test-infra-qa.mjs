import '../server/loadEnv.js';
import { config } from '../server/config.js';
import { createRedisClient } from '../server/redisConnection.js';
import mysql from 'mysql2/promise';
import { initDatabase } from '../server/database.js';

console.log('Perfil:', config.profile);
console.log('MySQL:', `${config.database.mysql.host}:${config.database.mysql.port}/${config.database.mysql.database}`);

try {
  const conn = await mysql.createConnection({
    host: config.database.mysql.host,
    port: config.database.mysql.port,
    user: config.database.mysql.user,
    password: config.database.mysql.password,
    database: config.database.mysql.database,
    connectTimeout: 10000,
  });
  const [rows] = await conn.query('SELECT DATABASE() AS db, NOW() AS now');
  console.log('[MySQL] OK', rows[0]);
  await conn.end();
} catch (e) {
  console.error('[MySQL] FALHA:', e.message);
  process.exitCode = 1;
}

try {
  const redis = createRedisClient({ connectTimeout: 10000 });
  const pong = await redis.ping();
  console.log('[Redis] OK', pong, `mode=${config.redis.mode} master=${config.redis.masterName}`);
  await redis.quit();
} catch (e) {
  console.error('[Redis] FALHA:', e.message);
  process.exitCode = 1;
}

try {
  await initDatabase();
  console.log('[DB] Tabela job_executions pronta');
  const { saveJobExecution, getJobExecutionByJobId } = await import('../server/database.js');
  const testJobId = `test-${Date.now()}`;
  await saveJobExecution({
    jobId: testJobId,
    massTypeLabel: 'teste-infra',
    environment: 'ti',
    executedAt: new Date(),
    status: 'completed',
    durationMs: 1,
  });
  const row = await getJobExecutionByJobId(testJobId);
  console.log('[DB] INSERT teste OK, executed_at=', row?.executed_at);
} catch (e) {
  console.error('[DB] FALHA:', e.message);
  process.exitCode = 1;
}

if (!process.exitCode) console.log('\nInfra QA acessível.');
