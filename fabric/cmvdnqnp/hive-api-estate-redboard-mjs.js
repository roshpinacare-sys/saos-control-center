import { HiveEngine } from '@hiveio/hive-js';
import fs from 'fs';
import path from 'path';

// Load environment variables
const HIVE_API_KEY = process.env.HIVE_API_KEY;

// Check if Hive API key exists
if (!HIVE_API_KEY) {
  throw new Error('Hive API key is missing. Set HIVE_API_KEY environment variable.');
}

// Initialize Hive engine with API key
const hive = new HiveEngine();
hive.use(async (req, res, next) => {
  req.headers['Authorization'] = `Bearer ${HIVE_API_KEY}`;
  next();
});

const stateFile = path.join(process.cwd(), 'state.json');
let state = {
  lastUpdate: null,
  error: null,
  data: null
};

// Try to load existing state
try {
  if (fs.existsSync(stateFile)) {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  }
} catch (err) {
  console.error('Error loading state:', err);
}

async function fetchEstateData() {
  try {
    // Example API call - replace with actual Hive API calls
    const response = await hive.api.call('condenser_api', 'get_accounts', [['your-username']]);
    
    state = {
      lastUpdate: new Date().toISOString(),
      error: null,
      data: response
    };
    
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    console.log('Estate data updated successfully');
  } catch (error) {
    state.error = error.message;
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    console.error('Error fetching estate data:', error);
  }
}

// Run the data fetch
fetchEstateData();

// Set up periodic updates
setInterval(fetchEstateData, 60000); // Update every minute
