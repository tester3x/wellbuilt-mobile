/**
 * Set a well as DOWN in Firebase
 * Updates the most recent response and processed packets
 *
 * Usage: node scripts/set-well-down.js "Kahuna 1"
 */

const https = require('https');

const FIREBASE_DATABASE_URL = "wellbuilt-sync-default-rtdb.firebaseio.com";
const FIREBASE_API_KEY = "AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI";

const wellName = process.argv[2];
if (!wellName) {
  console.error('Usage: node scripts/set-well-down.js "Well Name"');
  process.exit(1);
}

const wellKey = wellName.replace(/ /g, '_');

function firebaseRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = `https://${FIREBASE_DATABASE_URL}${path}?key=${FIREBASE_API_KEY}`;
    const urlObj = new URL(url);

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : null);
        } catch (e) {
          resolve(body);
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function main() {
  console.log(`Setting ${wellName} (${wellKey}) as DOWN...\n`);

  // 1. Get the most recent response packet
  console.log('Fetching latest response packet...');
  const responses = await firebaseRequest('GET', `/outgoing/${wellKey}.json?orderBy="$key"&limitToLast=1`);

  if (!responses || Object.keys(responses).length === 0) {
    console.error('No response packets found for', wellName);
    process.exit(1);
  }

  const responseKey = Object.keys(responses)[0];
  const responseData = responses[responseKey];
  console.log(`Found response: ${responseKey}`);
  console.log(`  Current level: ${responseData.currentLevel}`);
  console.log(`  Current isDown: ${responseData.isDown}`);

  // 2. Update response to mark as down
  console.log('\nUpdating response to DOWN...');
  await firebaseRequest('PATCH', `/outgoing/${wellKey}/${responseKey}.json`, {
    isDown: true,
    currentLevel: "Down"
  });
  console.log('  Response updated!');

  // 3. Get the most recent processed packet
  console.log('\nFetching latest processed packet...');
  const processed = await firebaseRequest('GET', `/packets/${wellKey}/processed.json?orderBy="$key"&limitToLast=1`);

  if (processed && Object.keys(processed).length > 0) {
    const processedKey = Object.keys(processed)[0];
    const processedData = processed[processedKey];
    console.log(`Found processed: ${processedKey}`);
    console.log(`  Current tankTopLevel: ${processedData.tankTopLevel}`);

    // 4. Update processed packet
    console.log('\nUpdating processed packet to DOWN...');
    await firebaseRequest('PATCH', `/packets/${wellKey}/processed/${processedKey}.json`, {
      isDown: true,
      tankTopLevel: "Down",
      tankAfterLevel: "Down"
    });
    console.log('  Processed packet updated!');
  } else {
    console.log('No processed packets found (may be normal)');
  }

  console.log('\n✓ Done! The app should pick up the change on next sync.');
  console.log('  Pull down to refresh on the app, or wait for background sync.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
