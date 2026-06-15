/**
 * Limpa dados do projeto em QA: MySQL + fila Redis (BullMQ).
 *
 * MySQL: job_executions, access_control_users, mass_type_settings
 * Redis: fila fdl-vtal-mass (jobs concluídos/falhos na tela) + eventos de monitor
 *
 * Windows:
 *   npm run db:clear-all
 *   npm run db:clear-all -- --confirm
 */
process.env.DATABASE_DRIVER = 'mysql';

await import('../server/loadEnv.js');
const { config } = await import('../server/config.js');
const mysql = (await import('mysql2/promise')).default;
const { Queue } = await import('bullmq');
const { createRedisClient } = await import('../server/redisConnection.js');
const { JOB_QUEUE_NAME } = await import('../server/queue.js');

const TABLES = ['job_executions', 'access_control_users', 'mass_type_settings'];
const MONITOR_KEY = 'fdl-vtal:monitor:events';

const confirm = process.argv.includes('--confirm');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Uso: npm run db:clear-all [-- --confirm]

Apaga:
  - Linhas das tabelas MySQL do projeto (não dropa tabelas)
  - Jobs na fila Redis (completed/failed/waiting — o que aparece no monitoramento)
  - Lista de eventos de monitor no Redis

Requer APP_PROFILE=qa e .env.qa com MYSQL_PASSWORD e REDIS_PASSWORD.

Opções:
  --confirm   Executa a limpeza (sem isso, só mostra contagens)
`);
  process.exit(0);
}

async function countMysql() {
  const { host, port, user, password, database } = config.database.mysql;
  const conn = await mysql.createConnection({ host, port, user, password, database });
  try {
    const counts = {};
    for (const table of TABLES) {
      const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM ${table}`);
      counts[table] = rows[0]?.n ?? 0;
    }
    return { conn, counts };
  } catch (err) {
    await conn.end();
    throw err;
  }
}

async function clearMysql(conn) {
  await conn.beginTransaction();
  try {
    for (const table of TABLES) {
      const [result] = await conn.query(`DELETE FROM ${table}`);
      console.log(`  ${table}: ${result.affectedRows ?? 0} linha(s) apagada(s)`);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

async function countRedis() {
  const connection = createRedisClient({ connectTimeout: 10000 });
  await connection.ping();
  const queue = new Queue(JOB_QUEUE_NAME, { connection });
  try {
    const jobCounts = await queue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
      'paused',
    );
    const monitorLen = await connection.llen(MONITOR_KEY);
    return { connection, queue, jobCounts, monitorLen };
  } catch (err) {
    await queue.close();
    connection.disconnect();
    throw err;
  }
}

async function clearRedis(connection, queue) {
  await queue.obliterate({ force: true });
  const monitorDeleted = await connection.del(MONITOR_KEY);
  console.log(`  fila ${JOB_QUEUE_NAME}: obliterate OK`);
  console.log(`  ${MONITOR_KEY}: ${monitorDeleted} chave(s) removida(s)`);
  await queue.close();
  connection.disconnect();
}

const { host, port, database } = config.database.mysql;
console.log(`MySQL: ${host}:${port}/${database} (perfil ${config.profile})`);
console.log(`Redis: ${config.redis.mode} → ${config.redis.masterName || config.redis.host}`);

let mysqlConn;
let redisConn;
let redisQueue;

try {
  const mysqlResult = await countMysql();
  mysqlConn = mysqlResult.conn;
  const redisResult = await countRedis();
  redisConn = redisResult.connection;
  redisQueue = redisResult.queue;

  console.log('\nMySQL — linhas atuais:');
  let mysqlTotal = 0;
  for (const table of TABLES) {
    const n = mysqlResult.counts[table];
    mysqlTotal += n;
    console.log(`  ${table}: ${n}`);
  }

  const jc = redisResult.jobCounts;
  const redisJobs =
    (jc.waiting || 0) +
    (jc.active || 0) +
    (jc.completed || 0) +
    (jc.failed || 0) +
    (jc.delayed || 0) +
    (jc.paused || 0);

  console.log('\nRedis — fila BullMQ:');
  console.log(`  ${JOB_QUEUE_NAME}: ${redisJobs} job(s) total`);
  console.log(
    `    waiting=${jc.waiting || 0} active=${jc.active || 0} completed=${jc.completed || 0} failed=${jc.failed || 0}`,
  );
  console.log(`  ${MONITOR_KEY}: ${redisResult.monitorLen} evento(s)`);

  if (mysqlTotal === 0 && redisJobs === 0 && redisResult.monitorLen === 0) {
    console.log('\nNada para apagar.');
    process.exit(0);
  }

  if (!confirm) {
    console.log('\nNada foi apagado. Rode com --confirm para executar.');
    process.exit(0);
  }

  console.log('\n=== Limpando MySQL ===');
  if (mysqlTotal > 0) {
    await clearMysql(mysqlConn);
  } else {
    console.log('  (já vazio)');
  }

  console.log('\n=== Limpando Redis ===');
  if (redisJobs > 0 || redisResult.monitorLen > 0) {
    await clearRedis(redisConn, redisQueue);
    redisConn = null;
    redisQueue = null;
  } else {
    console.log('  (já vazio)');
    await redisQueue.close();
    redisConn.disconnect();
    redisConn = null;
    redisQueue = null;
  }

  console.log('\nLimpeza concluída.');
  console.log('Recarregue o monitoramento (Ctrl+F5). ACL e tipos de massa voltam no próximo restart da API.');
} finally {
  if (mysqlConn) await mysqlConn.end();
  if (redisQueue) await redisQueue.close();
  if (redisConn) redisConn.disconnect();
}
