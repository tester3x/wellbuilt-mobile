const https = require('https');

const FIREBASE_URL = 'https://wellbuilt-sync-default-rtdb.firebaseio.com';

function firebaseDelete(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(FIREBASE_URL + path + '.json');
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'DELETE'
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });
}

// Fetch all processed packets
https.get(FIREBASE_URL + '/packets/processed.json', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', async () => {
    const packets = JSON.parse(data);
    const phantomPackets = [];

    for (const [id, packet] of Object.entries(packets)) {
      // Phantom = no driverId/driverName
      const hasDriverId = packet.driverId && packet.driverId.length > 0;
      const hasDriverName = packet.driverName && packet.driverName.length > 0;

      if (!hasDriverId || !hasDriverName) {
        phantomPackets.push({
          id,
          wellName: packet.wellName,
          tankLevel: packet.tankLevelFeet,
          wellDown: packet.wellDown,
          timezone: packet.timezone,
          dateTime: packet.dateTime
        });
      }
    }

    console.log('Found', phantomPackets.length, 'packets without driver authentication:\n');
    phantomPackets.forEach(p => {
      console.log('  -', p.id);
      console.log('    Well:', p.wellName, '| Level:', p.tankLevel, '| Down:', p.wellDown);
      console.log('    DateTime:', p.dateTime, '| TZ:', p.timezone);
      console.log('');
    });

    // Delete them
    console.log('\nDeleting phantom packets...\n');
    for (const p of phantomPackets) {
      try {
        await firebaseDelete('/packets/processed/' + p.id);
        console.log('  Deleted:', p.id);
      } catch (e) {
        console.log('  FAILED:', p.id, e.message);
      }
    }

    console.log('\nDone! Deleted', phantomPackets.length, 'phantom packets.');
  });
});
