/**
 * Clean up performance data - delete rows with crazy predictions
 * (predictions > 20 feet / 240 inches are obviously wrong)
 */

const https = require('https');

const FIREBASE_DATABASE_URL = "wellbuilt-sync-default-rtdb.firebaseio.com";
const FIREBASE_API_KEY = "AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI";

function firebaseRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = `/${path}.json?auth=${FIREBASE_API_KEY}`;
    const options = {
      hostname: FIREBASE_DATABASE_URL,
      port: 443,
      path: url,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body ? JSON.parse(body) : null);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function main() {
  console.log("Loading performance data...\n");

  const perfData = await firebaseRequest('GET', 'performance');

  if (!perfData) {
    console.log('No performance data found');
    return;
  }

  console.log('Scanning all wells for crazy predictions (>240 inches / 20 feet)...\n');

  let totalDeleted = 0;

  for (const [wellKey, wellData] of Object.entries(perfData)) {
    if (!wellData.rows) continue;

    let wellDeleted = 0;
    const toDelete = [];

    for (const [rowKey, row] of Object.entries(wellData.rows)) {
      // If predicted > 240 inches (20 feet), it's garbage
      if (row.p > 240) {
        toDelete.push({ key: rowKey, row });
      }
    }

    if (toDelete.length > 0) {
      const wellName = wellData.wellName || wellKey;
      console.log(`${wellName}:`);

      for (const item of toDelete) {
        const predFt = (item.row.p / 12).toFixed(1);
        const actFt = (item.row.a / 12).toFixed(1);
        console.log(`  Deleting: ${item.key} | pred: ${item.row.p}in (${predFt}ft) | actual: ${item.row.a}in (${actFt}ft)`);
        await firebaseRequest('DELETE', `performance/${wellKey}/rows/${item.key}`);
        wellDeleted++;
      }

      totalDeleted += wellDeleted;
      console.log('');
    }
  }

  console.log(`Total deleted across all wells: ${totalDeleted}`);
}

main().catch(console.error);
