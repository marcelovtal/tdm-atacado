import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

dotenv.config({ path: path.join(rootDir, '.env') });

/** FDL_APP_PROFILE vem dos scripts npm — tem prioridade sobre APP_PROFILE do terminal Windows. */
const profile = (
  process.env.FDL_APP_PROFILE ||
  process.env.APP_PROFILE ||
  'local'
).trim().toLowerCase();

const profileEnvPath = path.join(rootDir, `.env.${profile}`);
if (fs.existsSync(profileEnvPath)) {
  dotenv.config({ path: profileEnvPath, override: true });
}

process.env.APP_PROFILE = profile;

export { profile, rootDir };
