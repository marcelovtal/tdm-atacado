import path from 'path';
import { fileURLToPath } from 'url';
import { profile } from './loadEnv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Único administrador da plataforma (Admin + ver todos os jobs). Demais VTs: permissões via ACL. */
export const PLATFORM_ADMIN_VT = 'VT422570';

function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  return v === '1' || v === 'true' || v === 'yes';
}

function envInt(name, fallback) {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

const QA_DEFAULTS = {
  redisMode: 'sentinel',
  redisHost: '10.101.37.169',
  redisPort: 6379,
  redisSentinelHost: 'ATDMQX02.local',
  redisSentinelPort: 26379,
  redisMasterName: 'TDMQA',
  databaseDriver: 'mysql',
  mysqlHost: 'ATDMQX01.local',
  mysqlPort: 3306,
  mysqlDatabase: 'tdm_qa',
  mysqlUser: 'automacaoqa',
  useMemoryQueue: false,
};

const LOCAL_DEFAULTS = {
  redisMode: 'standalone',
  redisHost: '127.0.0.1',
  redisPort: 6379,
  redisSentinelHost: '127.0.0.1',
  redisSentinelPort: 26379,
  redisMasterName: 'mymaster',
  databaseDriver: 'sqlite',
  mysqlHost: '127.0.0.1',
  mysqlPort: 3306,
  mysqlDatabase: 'tdm_qa',
  mysqlUser: 'root',
  useMemoryQueue: true,
};

const defaults = profile === 'qa' ? QA_DEFAULTS : LOCAL_DEFAULTS;

const redisMode = (process.env.REDIS_MODE || defaults.redisMode).trim().toLowerCase();
const sentinelHost = process.env.REDIS_SENTINEL_HOST || process.env.REDIS_HOST || defaults.redisSentinelHost;
const sentinelPort = envInt('REDIS_SENTINEL_PORT', defaults.redisSentinelPort);

export const config = {
  profile,
  port: envInt('PORT', 3333),
  /** Caminho para a raiz do FDL VTAL (scripts/, support/, config/). */
  vtalPath: path.resolve(__dirname, '..'),
  useMemoryQueue: envBool('USE_MEMORY_QUEUE', defaults.useMemoryQueue),
  redis: {
    mode: redisMode,
    host: process.env.REDIS_HOST || defaults.redisHost,
    port: envInt('REDIS_PORT', defaults.redisPort),
    password: process.env.REDIS_PASSWORD || undefined,
    sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD || process.env.REDIS_PASSWORD || undefined,
    masterName: process.env.REDIS_MASTER_NAME || defaults.redisMasterName,
    sentinels: [{ host: sentinelHost, port: sentinelPort }],
    maxRetriesPerRequest: null,
  },
  database: {
    driver: (process.env.DATABASE_DRIVER || defaults.databaseDriver).trim().toLowerCase(),
    mysql: {
      host: process.env.MYSQL_HOST || defaults.mysqlHost,
      port: envInt('MYSQL_PORT', defaults.mysqlPort),
      user: process.env.MYSQL_USER || defaults.mysqlUser,
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || defaults.mysqlDatabase,
      connectionLimit: envInt('MYSQL_POOL_SIZE', 10),
    },
    sqlitePath: process.env.SQLITE_PATH || path.join(__dirname, 'data', 'mass-generator.sqlite'),
  },
  workerConcurrency: envInt('WORKER_CONCURRENCY', profile === 'qa' ? 1 : 3),
  jobAttempts: envInt('JOB_ATTEMPTS', 2),
  auth: {
    mode: (process.env.AUTH_MODE || (profile === 'local' ? 'local' : 'ldap')).trim().toLowerCase(),
    ldap: {
      url: process.env.LDAP_URL || 'ldap://10.101.0.13:389',
      domain: process.env.LDAP_DOMAIN || 'CORPORATIVO',
      timeoutMs: envInt('LDAP_TIMEOUT_MS', 15000),
    },
    sessionSecret: process.env.SESSION_SECRET || 'fdl-vtal-change-in-production',
    sessionTtlMs: envInt('SESSION_TTL_MS', 12 * 60 * 60 * 1000),
    platformAdmins: [PLATFORM_ADMIN_VT],
  },
};

export const ENVIRONMENTS = ['ti', 'trg'];
export const MASS_TYPES = [
  { id: 'lead-pedido', label: 'Lead → IP Connect → Pedido', script: 'gerar-pedido-ip-connect.js', envVars: {} },
  { id: 'lead-vpn-pedido', label: 'Lead → VPN → Pedido', script: 'gerar-pedido-vpn.js', envVars: {} },
  { id: 'lead-link-dedicado-pedido', label: 'Lead → Link Dedicado → Pedido', script: 'gerar-pedido-link-dedicado.js', envVars: {} },
  { id: 'massa-pronta-opp-pedido', label: 'IP Connect (massa pronta)', script: 'gerar-pedido-massa-pronta-ip-connect.js', envVars: {} },
  {
    id: 'massa-pronta-opp-pedido-pega',
    label: 'IP (massa pronta + Config PEGA)',
    script: 'gerar-pedido-massa-pronta-ip-connect-config-pega.js',
    envVars: {},
  },
  { id: 'massa-pronta-opp-pedido-vpn', label: 'VPN (massa pronta)', script: 'gerar-pedido-massa-pronta-vpn.js', envVars: {} },
  {
    id: 'massa-pronta-opp-pedido-vpn-pega',
    label: 'VPN (massa pronta + Config PEGA)',
    script: 'gerar-pedido-massa-pronta-vpn-connect-config-pega.js',
    envVars: {},
  },
  { id: 'massa-pronta-opp-pedido-link-dedicado', label: 'Link Dedicado (massa pronta)', script: 'gerar-pedido-massa-pronta-link-dedicado.js', envVars: {} },
  {
    id: 'massa-pronta-opp-pedido-link-dedicado-pega',
    label: 'Link Dedicado (massa pronta + Config PEGA)',
    script: 'gerar-pedido-massa-pronta-link-dedicado-config-pega.js',
    envVars: {},
  },
  { id: 'conta-ativacao-brm', label: 'Conta Até Ativação BRM', script: 'ativacao-brm.js', envVars: {} },
  { id: 'conta-ativacao-brm-msa', label: 'Conta Até Ativação BRM (MSA)', script: 'ativacao-brm-msa.js', envVars: {} },
  {
    id: 'conta-ativacao-brm-massa-pronta',
    label: 'BRM (massa pronta)',
    script: 'ativacao-brm-massa-pronta.js',
    envVars: {},
  },
];
