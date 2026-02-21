/**
 * Fix VBA Export Formats
 *
 * The VBA export sent fields in decimal format, but the app expects:
 * - flowRate: "H:MM:SS" (e.g., "0:07:30")
 * - timeDif: "H:MM" (e.g., "12:30")
 * - estTimeToPull: "H:MM" (e.g., "48:30")
 * - tankAfterFeet: "F'I\"" (e.g., "4'11\"")
 *
 * Run with: node scripts/fix-vba-export-formats.js [--write]
 * Without --write flag, does a dry run showing what would be updated
 */

const https = require('https');

const FIREBASE_DATABASE_URL = "wellbuilt-sync-default-rtdb.firebaseio.com";
const FIREBASE_API_KEY = "AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI";

const DRY_RUN = !process.argv.includes('--write');

// Convert decimal days to H:MM:SS format (for flowRate per foot)
function decimalDaysToHMS(days) {
  if (!days || isNaN(days)) return null;
  const totalSeconds = Math.round(days * 24 * 60 * 60);
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Convert decimal days to H:MM format (for timeDif, estTimeToPull)
function decimalDaysToHM(days) {
  if (!days || isNaN(days)) return null;
  const totalMinutes = Math.round(days * 24 * 60);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${hours}:${String(mins).padStart(2, '0')}`;
}

// Convert decimal feet to F'I" format
function decimalFeetToFI(feet) {
  if (feet === undefined || feet === null || isNaN(feet)) return null;
  const totalInches = Math.floor(feet * 12 + 0.0001);
  const ft = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${ft}'${inches}"`;
}

// Check if value looks like a decimal number string (not already formatted)
function isDecimalString(val) {
  if (typeof val !== 'string') return false;
  // Already in H:MM:SS or H:MM format
  if (val.includes(':')) return false;
  // Already in F'I" format
  if (val.includes("'") || val.includes('"')) return false;
  // Check if it's a parseable decimal
  const num = parseFloat(val);
  return !isNaN(num);
}

// Check if value is a raw number that needs formatting
function isRawNumber(val) {
  return typeof val === 'number';
}

async function firebaseGet(path) {
  return new Promise((resolve, reject) => {
    const url = `https://${FIREBASE_DATABASE_URL}/${path}.json?auth=${FIREBASE_API_KEY}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function firebasePatch(path, updates) {
  return new Promise((resolve, reject) => {
    const url = `https://${FIREBASE_DATABASE_URL}/${path}.json?auth=${FIREBASE_API_KEY}`;
    const postData = JSON.stringify(updates);

    const options = {
      hostname: FIREBASE_DATABASE_URL,
      path: `/${path}.json?auth=${FIREBASE_API_KEY}`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve(res.statusCode === 200);
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN (use --write to apply changes) ===" : "=== WRITING CHANGES ===");
  console.log("");

  // Get all processed packets
  console.log("Fetching processed packets...");
  const processed = await firebaseGet("packets/processed");

  if (!processed) {
    console.log("No processed packets found");
    return;
  }

  const packetIds = Object.keys(processed);
  console.log(`Found ${packetIds.length} packets`);

  let needsFixCount = 0;
  let fixedCount = 0;
  let errorCount = 0;

  for (const packetId of packetIds) {
    const packet = processed[packetId];
    const updates = {};

    // Check flowRate - should be H:MM:SS, not decimal
    if (packet.flowRate && (isDecimalString(packet.flowRate) || isRawNumber(packet.flowRate))) {
      const days = packet.flowRateDays || parseFloat(packet.flowRate);
      if (days && !isNaN(days)) {
        updates.flowRate = decimalDaysToHMS(days);
      }
    }

    // Check timeDif - should be H:MM, not decimal
    if (packet.timeDif && (isDecimalString(packet.timeDif) || isRawNumber(packet.timeDif))) {
      const days = packet.timeDifDays || parseFloat(packet.timeDif);
      if (days && !isNaN(days)) {
        updates.timeDif = decimalDaysToHM(days);
      }
    }

    // Check estTimeToPull - should be H:MM, not decimal
    if (packet.estTimeToPull && (isDecimalString(packet.estTimeToPull) || isRawNumber(packet.estTimeToPull))) {
      const days = parseFloat(packet.estTimeToPull);
      if (days && !isNaN(days)) {
        updates.estTimeToPull = decimalDaysToHM(days);
      }
    }

    // Check tankAfterFeet - should be F'I", not decimal number
    if (isRawNumber(packet.tankAfterFeet)) {
      updates.tankAfterFeet = decimalFeetToFI(packet.tankAfterFeet);
    }

    if (Object.keys(updates).length > 0) {
      needsFixCount++;

      if (DRY_RUN) {
        if (needsFixCount <= 5) {
          console.log(`\nWould fix ${packetId}:`);
          for (const [key, val] of Object.entries(updates)) {
            console.log(`  ${key}: ${JSON.stringify(packet[key])} -> ${JSON.stringify(val)}`);
          }
        }
      } else {
        try {
          await firebasePatch(`packets/processed/${packetId}`, updates);
          fixedCount++;
          if (fixedCount % 100 === 0) {
            console.log(`Fixed ${fixedCount} packets...`);
          }
        } catch (err) {
          console.error(`Error fixing ${packetId}:`, err.message);
          errorCount++;
        }
      }
    }
  }

  console.log("");
  console.log("=== SUMMARY ===");
  console.log(`Total packets: ${packetIds.length}`);
  console.log(`Need format fix: ${needsFixCount}`);
  if (!DRY_RUN) {
    console.log(`Fixed: ${fixedCount}`);
    console.log(`Errors: ${errorCount}`);
  } else {
    console.log("\nRun with --write to apply these changes");
  }
}

main().catch(console.error);
