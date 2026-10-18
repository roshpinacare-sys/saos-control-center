import { HiveClient } from '@hiveio/hive-js';

const API_KEY = process.env.HIVE_API_KEY;
if (!API_KEY) {
  console.error('[Hive Auth] Hive API authentication failed: missing key');
  throw new Error('HIVE_AUTH_MISSING_KEY');
}

console.log('[Hive Auth] Hive API authentication attempted');

const client = new HiveClient('https://api.hive.blog', { headers: { 'X-API-Key': API_KEY } });

export { client };