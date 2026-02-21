/**
 * Replay Atlas 1 processed packets through incoming to fix bad enrichment data.
 *
 * Takes processed packets from Feb 2 onward, strips them to original pull fields,
 * and writes them to packets/incoming one at a time (waiting for Cloud Function
 * to process each before sending the next).
 *
 * Run: node scripts/replay-atlas1.js [--write]
 * Without --write, does a dry run showing what would be replayed.
 */

const https = require('https');

const FIREBASE_DATABASE_URL = "wellbuilt-sync-default-rtdb.firebaseio.com";
const FIREBASE_API_KEY = "AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI";

const DRY_RUN = !process.argv.includes('--write');

// Original pull packet fields - everything else is enrichment added by Cloud Function
const ORIGINAL_FIELDS = [
  'wellName', 'tankLevelFeet', 'bblsTaken', 'dateTime', 'dateTimeUTC',
  'driverId', 'driverName', 'timezone', 'wellDown', 'packetId',
  // Edit-specific fields
  'requestType', 'isEdit', 'originalPacketId',
  // These are sometimes on the original
  'vbaWasDown',
];

function firebaseRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    // Split path from query params, encode spaces
  let url;
  const qIdx = path.indexOf('?');
  if (qIdx >= 0) {
    const basePath = path.substring(0, qIdx);
    const query = path.substring(qIdx);
    url = `/${basePath}.json?auth=${FIREBASE_API_KEY}&${query.substring(1)}`.replace(/ /g, '%20');
  } else {
    url = `/${path}.json?auth=${FIREBASE_API_KEY}`;
  }
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForProcessed(packetId, maxWaitMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const result = await firebaseRequest('GET', `packets/processed/${packetId}`);
    if (result && result.processedAt) {
      return true;
    }
    // Check if it's still in incoming
    const incoming = await firebaseRequest('GET', `packets/incoming/${packetId}`);
    if (!incoming) {
      // Deleted from incoming but not in processed yet - give it a moment
      await sleep(1000);
      const result2 = await firebaseRequest('GET', `packets/processed/${packetId}`);
      if (result2) return true;
    }
    await sleep(2000);
  }
  return false;
}

async function main() {
  if (DRY_RUN) {
    console.log("=== DRY RUN - No changes will be made ===");
    console.log("Run with --write flag to actually replay packets\n");
  } else {
    console.log("=== REPLAYING PACKETS ===\n");
  }

  // Fetch all Atlas 1 processed packets
  console.log("Fetching Atlas 1 processed packets...");
  const processedData = await firebaseRequest('GET',
    'packets/processed?orderBy="wellName"&equalTo="Atlas 1"');

  if (!processedData) {
    console.log("No processed packets found.");
    return;
  }

  // Filter to valid pulls from Feb 2 onward with bad enrichment, sort chronologically
  const cutoffDate = new Date('2026-02-02T00:00:00Z').getTime();

  const packetsToReplay = Object.entries(processedData)
    .filter(([key, packet]) => {
      // Skip history requests
      if (key.startsWith('history_')) return false;
      if (packet.requestType === 'wellHistory' || packet.requestType === 'performanceReport') return false;
      // Skip packets that were edited (superseded by edit packet)
      if (packet.wasEdited === true) return false;

      // Only packets from Feb 2 onward
      const ts = packet.dateTimeUTC ? new Date(packet.dateTimeUTC).getTime() :
                 new Date(packet.dateTime).getTime();
      return ts >= cutoffDate;
    })
    .map(([key, packet]) => {
      const ts = packet.dateTimeUTC ? new Date(packet.dateTimeUTC).getTime() :
                 new Date(packet.dateTime).getTime();
      return { key, packet, timestamp: ts };
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  console.log(`Found ${packetsToReplay.length} packets to replay (Feb 2 onward)\n`);

  // Show what we'll replay
  for (const { key, packet } of packetsToReplay) {
    // Strip to original fields only
    const originalPacket = {};
    for (const field of ORIGINAL_FIELDS) {
      if (packet[field] !== undefined) {
        originalPacket[field] = packet[field];
      }
    }

    const isEdit = key.startsWith('edit_') || packet.requestType === 'edit';

    console.log(`${isEdit ? 'EDIT' : 'PULL'}: ${key}`);
    console.log(`  ${packet.dateTime} | tank: ${packet.tankLevelFeet} | bbls: ${packet.bblsTaken}`);
    console.log(`  BAD timeDif: ${packet.timeDif} | BAD flowRate: ${packet.flowRate}`);

    if (!DRY_RUN) {
      // Delete the existing processed packet first so Cloud Function can rewrite it
      console.log(`  Deleting processed/${key}...`);
      await firebaseRequest('DELETE', `packets/processed/${key}`);

      // For edits, we need to mark the original as wasEdited again
      // (the Cloud Function does this, but only if the original exists)

      // Write to incoming - Cloud Function will pick it up
      console.log(`  Writing to incoming/${key}...`);
      await firebaseRequest('PUT', `packets/incoming/${key}`, originalPacket);

      // Wait for Cloud Function to process it
      console.log(`  Waiting for processing...`);
      const processed = await waitForProcessed(key);
      if (processed) {
        // Read back the new enrichment to verify
        const newPacket = await firebaseRequest('GET', `packets/processed/${key}`);
        console.log(`  NEW timeDif: ${newPacket?.timeDif} | NEW flowRate: ${newPacket?.flowRate}`);
      } else {
        console.log(`  WARNING: Packet may not have been processed yet`);
      }

      // Small delay between packets to not overwhelm the function
      await sleep(500);
    }
    console.log('');
  }

  console.log("Done!");
  if (DRY_RUN) {
    console.log("\nRun with --write to actually replay these packets.");
  }
}

main().catch(console.error);
