import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { normalizeVt } from './vt.js';
import { isPlatformAdmin, getPlatformAdminVts } from './platformAdmin.js';
import {
  listAccessControlUsersMysql,
  replaceAccessControlUsersMysql,
} from '../database/mysqlStore.js';

const useMysql = config.database.driver === 'mysql';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ACL_PATH =
  process.env.ACCESS_CONTROL_PATH || path.join(__dirname, '../data/access-control.json');

const DEFAULT_ACL = {
  users: {
    VT422293: { dashboard: true, cancelJobs: false },
    VT422336: { dashboard: false, cancelJobs: false },
    VT422493: { dashboard: true, cancelJobs: true },
  },
};

/** Cache em memória — atualizado no init e a cada PUT. */
let usersCache = null;

function readAclFile() {
  try {
    if (!fs.existsSync(ACL_PATH)) {
      fs.mkdirSync(path.dirname(ACL_PATH), { recursive: true });
      fs.writeFileSync(ACL_PATH, JSON.stringify(DEFAULT_ACL, null, 2), 'utf-8');
      return structuredClone(DEFAULT_ACL);
    }
    const data = JSON.parse(fs.readFileSync(ACL_PATH, 'utf-8'));
    data.users = data.users && typeof data.users === 'object' ? data.users : {};
    return data;
  } catch (err) {
    console.error('[ACL] Erro ao ler access-control.json:', err.message);
    return structuredClone(DEFAULT_ACL);
  }
}

function writeAclFile(usersMap) {
  fs.mkdirSync(path.dirname(ACL_PATH), { recursive: true });
  fs.writeFileSync(ACL_PATH, JSON.stringify({ users: usersMap }, null, 2), 'utf-8');
}

function rowsToMap(rows) {
  const map = {};
  for (const row of rows) {
    const vt = normalizeVt(row.vt);
    if (!vt) continue;
    map[vt] = {
      dashboard: !!row.dashboard,
      cancelJobs: !!row.cancelJobs,
    };
  }
  return map;
}

function mapToRows(map) {
  return Object.entries(map)
    .map(([vt, perms]) => ({
      vt: normalizeVt(vt),
      dashboard: !!perms.dashboard,
      cancelJobs: !!perms.cancelJobs,
    }))
    .filter((row) => row.vt && row.vt.startsWith('VT'))
    .sort((a, b) => a.vt.localeCompare(b.vt));
}

function getUsersMap() {
  if (usersCache) return usersCache;
  const file = readAclFile();
  usersCache = file.users || {};
  return usersCache;
}

function setUsersCache(map) {
  usersCache = map;
}

export { isPlatformAdmin };

/** Chamar após initDatabase() — carrega ACL do MySQL ou JSON. */
export async function initAccessControl() {
  if (useMysql) {
    let rows = await listAccessControlUsersMysql();
    if (!rows.length) {
      const seed = readAclFile().users || DEFAULT_ACL.users;
      const seedRows = mapToRows(seed);
      if (seedRows.length) {
        await replaceAccessControlUsersMysql(seedRows);
        rows = await listAccessControlUsersMysql();
        console.log(`[ACL] Permissões iniciais importadas do JSON (${rows.length} VT(s))`);
      }
    }
    setUsersCache(rowsToMap(rows));
    console.log(`[ACL] MySQL access_control_users (${rows.length} VT(s))`);
    return;
  }
  setUsersCache(readAclFile().users || {});
  console.log(`[ACL] Arquivo ${ACL_PATH}`);
}

export function getPermissionsForVt(vt) {
  if (config.auth.mode === 'local') {
    return { dashboard: true, cancelJobs: true, manageAccess: true };
  }
  const id = normalizeVt(vt);
  if (!id) {
    return { dashboard: false, cancelJobs: false, manageAccess: false };
  }
  if (isPlatformAdmin(id)) {
    return { dashboard: true, cancelJobs: true, manageAccess: true };
  }
  const row = getUsersMap()[id] || {};
  return {
    dashboard: !!row.dashboard,
    cancelJobs: !!row.cancelJobs,
    manageAccess: false,
  };
}

export function listAccessControl() {
  const users = mapToRows(getUsersMap());
  return {
    platformAdmins: getPlatformAdminVts(),
    users,
  };
}

function normalizeIncomingUsers(users = []) {
  const nextUsers = {};
  for (const row of users) {
    const vt = normalizeVt(row.vt);
    if (!vt || !vt.startsWith('VT')) continue;
    if (isPlatformAdmin(vt)) continue;
    nextUsers[vt] = {
      dashboard: !!row.dashboard,
      cancelJobs: !!row.cancelJobs,
    };
  }
  return nextUsers;
}

export async function updateAccessControl({ users = [] }) {
  const nextUsers = normalizeIncomingUsers(users);
  const rows = mapToRows(nextUsers);

  if (useMysql) {
    await replaceAccessControlUsersMysql(rows);
  } else {
    writeAclFile(nextUsers);
  }

  setUsersCache(nextUsers);
  return listAccessControl();
}
