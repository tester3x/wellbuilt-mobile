// Upload response files from Outgoing folder to Firebase
const fs = require('fs');
const path = require('path');
const https = require('https');

const FIREBASE_DATABASE_URL = 'https://wellbuilt-sync-default-rtdb.firebaseio.com';
const FIREBASE_API_KEY = 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';
const COLL_OUTGOING = 'packets/outgoing';

const OUTGOING_DIR = 'C:\\Users\\WellBuilt\\OneDrive\\WellBuilt\\Outgoing';

function uploadToFirebase(responseId, data) {
  return new Promise((resolve, reject) => {
    const url = `${FIREBASE_DATABASE_URL}/${COLL_OUTGOING}/${responseId}.json?auth=${FIREBASE_API_KEY}`;
    const urlObj = new URL(url);

    const jsonData = JSON.stringify(data);

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(jsonData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ success: true, responseId });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(jsonData);
    req.end();
  });
}

async function main() {
  console.log('Reading files from:', OUTGOING_DIR);

  const files = fs.readdirSync(OUTGOING_DIR).filter(f => f.endsWith('.json'));
  console.log(`Found ${files.length} response files`);

  let uploaded = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const filePath = path.join(OUTGOING_DIR, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);

      // Extract responseId from filename (remove .json extension and spaces)
      const responseId = path.basename(file, '.json').replace(/\s+/g, '');

      console.log(`Uploading: ${responseId}`);
      await uploadToFirebase(responseId, data);
      uploaded++;
      console.log(`  OK - ${uploaded}/${files.length}`);
    } catch (err) {
      console.error(`  FAILED: ${file} - ${err.message}`);
      failed++;
    }
  }

  console.log('\n=== DONE ===');
  console.log(`Uploaded: ${uploaded}`);
  console.log(`Failed: ${failed}`);
}

main().catch(console.error);
