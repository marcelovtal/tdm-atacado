/**
 * Remove linhas de job_executions **somente no MySQL** (histórico do painel em QA).
 *
 * Usa credenciais de .env + .env.qa (APP_PROFILE=qa). Não mexe no SQLite local.
 *
 * Por padrão só mostra o que seria apagado. Use --confirm para executar.
 *
 * Exemplos:
 *   cross-env APP_PROFILE=qa node scripts/clear-job-executions.mjs --all
 *   cross-env APP_PROFILE=qa node scripts/clear-job-executions.mjs --all --confirm
 *   cross-env APP_PROFILE=qa node scripts/clear-job-executions.mjs --status failed --confirm
 */
process.env.DATABASE_DRIVER = 'mysql';

await import('../server/loadEnv.js');
const { config } = await import('../server/config.js');
const { initMysqlDatabase } = await import('../server/database/mysqlStore.js');
const mysql = (await import('mysql2/promise')).default;

function parseArgs(argv) {
  const opts = {
    all: false,
    confirm: false,
    status: null,
    user: null,
    before: null,
    ids: null,
    limit: null,
  };
  for (const arg of argv) {
    if (arg === '--all') opts.all = true;
    else if (arg === '--confirm') opts.confirm = true;
    else if (arg.startsWith('--status=')) opts.status = arg.slice('--status='.length).trim();
    else if (arg.startsWith('--user=')) opts.user = arg.slice('--user='.length).trim();
    else if (arg.startsWith('--before=')) opts.before = arg.slice('--before='.length).trim();
    else if (arg.startsWith('--ids=')) {
      opts.ids = arg
        .slice('--ids='.length)
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n));
    } else if (arg.startsWith('--limit=')) {
      opts.limit = parseInt(arg.slice('--limit='.length).trim(), 10) || null;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Uso: cross-env APP_PROFILE=qa node scripts/clear-job-executions.mjs [opções]

MySQL apenas (tabela job_executions). Não altera SQLite local.

Opções:
  --all                Apaga todo o histórico (sem filtro)
  --status=failed      Só jobs com esse status
  --user=VT12          Só jobs desse user_code
  --before=YYYY-MM-DD  Só jobs executados antes desta data
  --ids=1,2,3          Só estes id
  --limit=N            Limita a N linhas (mais antigas primeiro)
  --confirm            Executa o DELETE (sem isso, só pré-visualiza)
`);
      process.exit(0);
    }
  }
  return opts;
}

function buildWhere(opts) {
  const clauses = [];
  const params = [];

  if (!opts.all) {
    if (opts.status) {
      clauses.push('status = ?');
      params.push(opts.status);
    }
    if (opts.user) {
      clauses.push('user_code = ?');
      params.push(opts.user);
    }
    if (opts.before) {
      clauses.push('executed_at < ?');
      params.push(`${opts.before} 23:59:59.999`);
    }
    if (opts.ids?.length) {
      clauses.push(`id IN (${opts.ids.map(() => '?').join(', ')})`);
      params.push(...opts.ids);
    }
  }

  if (!opts.all && !clauses.length) {
    return { error: 'Informe --all ou pelo menos um filtro (--status, --user, --before, --ids).' };
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limitSql = opts.limit != null && opts.limit > 0 ? ` LIMIT ${opts.limit}` : '';
  return { where, params, limitSql };
}

async function mysqlConnect() {
  const { host, port, user, password, database } = config.database.mysql;
  return mysql.createConnection({ host, port, user, password, database });
}

async function countAndPreview(conn, where, params, limitSql) {
  const [countRows] = await conn.execute(
    `SELECT COUNT(*) AS n FROM job_executions ${where}`,
    params,
  );
  const [preview] = await conn.execute(
    `SELECT id, user_code, status, mass_type_label, executed_at
     FROM job_executions ${where}
     ORDER BY id ASC${limitSql}`,
    params,
  );
  return { count: countRows[0]?.n ?? 0, preview };
}

async function deleteRows(conn, where, params, limitSql) {
  let sql;
  if (limitSql) {
    sql = `DELETE FROM job_executions WHERE id IN (
      SELECT id FROM (
        SELECT id FROM job_executions ${where} ORDER BY id ASC${limitSql}
      ) AS to_delete
    )`;
  } else {
    sql = `DELETE FROM job_executions ${where}`;
  }
  const [result] = await conn.execute(sql, params);
  return result.affectedRows ?? 0;
}

const opts = parseArgs(process.argv.slice(2));
const built = buildWhere(opts);
if (built.error) {
  console.error(built.error);
  process.exit(1);
}

const { host, port, database } = config.database.mysql;
console.log(`MySQL: ${host}:${port}/${database} (perfil ${config.profile})`);

await initMysqlDatabase();

const conn = await mysqlConnect();
const { where, params, limitSql } = built;

try {
  const { count, preview } = await countAndPreview(conn, where, params, limitSql);

  console.log(`\nLinhas que batem com o filtro: ${count}`);
  if (preview.length) {
    console.log('\nPrévia (até 20):');
    for (const row of preview.slice(0, 20)) {
      console.log(
        `  #${row.id}  ${row.user_code || '—'}  ${row.status}  ${row.mass_type_label || '—'}  ${row.executed_at}`,
      );
    }
    if (preview.length > 20) {
      console.log(`  … e mais ${preview.length - 20} na prévia`);
    }
  }

  if (!opts.confirm) {
    console.log('\nNada foi apagado. Rode com --confirm para executar o DELETE no MySQL.');
    process.exit(0);
  }

  if (count === 0) {
    console.log('\nNenhuma linha para apagar.');
    process.exit(0);
  }

  const deleted = await deleteRows(conn, where, params, limitSql);
  console.log(`\nApagadas ${deleted} linha(s) de job_executions no MySQL.`);
} finally {
  await conn.end();
}
