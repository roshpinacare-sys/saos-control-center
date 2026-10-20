import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_FILE = path.resolve(__dirname, '../state.json');
const HIVE_API_KEY = process.env.HIVE_API_KEY;

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function setError(message) {
  const state = readState();
  state.error = message;
  state.lastUpdate = new Date().toISOString();
  writeState(state);
}

async function fetchWithAuth(url, options = {}) {
  if (!HIVE_API_KEY || HIVE_API_KEY.trim() === '') {
    const msg = 'Hive API key is missing. Set HIVE_API_KEY environment variable.';
    setError(msg);
    throw new Error(msg);
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${HIVE_API_KEY}`,
    ...options.headers
  };

  const response = await fetch(url, { ...options, headers });
  
  if (response.status === 401) {
    const msg = 'Hive API authentication failed. Check HIVE_API_KEY.';
    setError(msg);
    throw new Error(msg);
  }

  return response;
}

async function main() {
  try {
    // Example Hive API call - replace with actual endpoint
    const response = await fetchWithAuth('https://api.hive.blog', {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'condenser_api.get_dynamic_global_properties',
        params: [],
        id: 1
      })
    });

    const data = await response.json();
    
    const state = readState();
    state.hiveData = data;
    state.lastUpdate = new Date().toISOString();
    delete state.error;
    writeState(state);

  } catch (err) {
    console.error('Estate redboard error:', err.message);
    process.exit(1);
  }
}

main();