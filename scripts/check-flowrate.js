const https = require('https');

function firebaseGet(path) {
  return new Promise((resolve, reject) => {
    const url = '/' + path + '.json?auth=AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';
    https.get({ hostname: 'wellbuilt-sync-default-rtdb.firebaseio.com', path: url }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

async function main() {
  const data = await firebaseGet('packets/processed');
  let withFlowRate = 0;
  let withoutFlowRate = 0;

  for (const [k, p] of Object.entries(data)) {
    if (p.requestType === 'edit' || p.wasEdited || !p.wellName) continue;
    if (p.flowRateDays !== undefined) {
      withFlowRate++;
    } else {
      withoutFlowRate++;
    }
  }

  console.log('Packets WITH flowRateDays:', withFlowRate);
  console.log('Packets WITHOUT flowRateDays:', withoutFlowRate);
}

main();
