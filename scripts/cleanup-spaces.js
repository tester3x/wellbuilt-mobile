// Delete Firebase keys that have spaces in them
const https = require('https');

const FIREBASE_DATABASE_URL = 'https://wellbuilt-sync-default-rtdb.firebaseio.com';
const FIREBASE_API_KEY = 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';

function firebaseDelete(path) {
  return new Promise((resolve, reject) => {
    const url = `${FIREBASE_DATABASE_URL}/${path}.json?auth=${FIREBASE_API_KEY}`;
    const urlObj = new URL(url);

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'DELETE'
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(res.statusCode === 200));
    });

    req.on('error', reject);
    req.end();
  });
}

function firebaseGet(path) {
  return new Promise((resolve, reject) => {
    const url = `${FIREBASE_DATABASE_URL}/${path}.json?auth=${FIREBASE_API_KEY}`;
    https.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

async function main() {
  const data = await firebaseGet('packets/outgoing');
  const keysWithSpaces = Object.keys(data || {}).filter(k => k.includes(' '));

  console.log(`Found ${keysWithSpaces.length} keys with spaces to delete`);

  for (const key of keysWithSpaces) {
    console.log(`Deleting: ${key}`);
    await firebaseDelete(`packets/outgoing/${key}`);
  }

  console.log('Done!');
}

main().catch(console.error);
