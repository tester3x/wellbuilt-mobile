/**
 * Clean up processed packets with anomalous flow rates
 *
 * Finds packets where accuracy (predicted/actual) is <70% or >150%
 * and deletes them from packets/processed
 *
 * Run with: node scripts/cleanup-anomaly-packets.js [--delete]
 * Without --delete flag, does a dry run showing what would be deleted
 */

const https = require('https');

const FIREBASE_DATABASE_URL = "wellbuilt-sync-default-rtdb.firebaseio.com";
const FIREBASE_API_KEY = "AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI";

const DRY_RUN = !process.argv.includes('--delete');

const MIN_ACCURACY = 0.70;  // 70%
const MAX_ACCURACY = 1.50;  // 150%

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

function parsePacketTimestamp(packet) {
  if (packet.dateTimeUTC) {
    return new Date(packet.dateTimeUTC).getTime();
  }
  if (packet.dateTime) {
    const match = packet.dateTime.match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+)(?::(\d+))?\s*(AM|PM)?/i);
    if (match) {
      let [, month, day, year, hours, minutes, seconds, ampm] = match;
      let h = parseInt(hours);
      if (ampm) {
        if (ampm.toUpperCase() === "PM" && h !== 12) h += 12;
        if (ampm.toUpperCase() === "AM" && h === 12) h = 0;
      }
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), h, parseInt(minutes), parseInt(seconds || "0")).getTime();
    }
    return new Date(packet.dateTime).getTime();
  }
  return NaN;
}

async function main() {
  if (DRY_RUN) {
    console.log("=== DRY RUN - No changes will be made ===");
    console.log("Run with --delete flag to actually delete packets\n");
  } else {
    console.log("=== DELETING PACKETS ===\n");
  }

  console.log(`Accuracy bounds: ${MIN_ACCURACY * 100}% - ${MAX_ACCURACY * 100}%\n`);

  // Load data
  console.log("Loading data from Firebase...\n");
  const [processedData, wellConfigData] = await Promise.all([
    firebaseRequest('GET', 'packets/processed'),
    firebaseRequest('GET', 'well_config')
  ]);

  if (!processedData) {
    console.log('No processed packets found');
    return;
  }

  // Group packets by well
  const wellPackets = {};

  for (const [key, packet] of Object.entries(processedData)) {
    // Skip non-pull packets
    if (packet.requestType === "edit" ||
        packet.requestType === "wellHistory" ||
        packet.requestType === "performanceReport" ||
        packet.requestType === "delete" ||
        key.startsWith("history_") ||
        packet.wasEdited === true) {
      continue;
    }

    const wellName = packet.wellName;
    if (!wellName) continue;

    const timestamp = parsePacketTimestamp(packet);
    if (isNaN(timestamp)) continue;

    if (!wellPackets[wellName]) wellPackets[wellName] = [];
    wellPackets[wellName].push({
      key,
      timestamp,
      dateTime: packet.dateTime,
      tankLevelFeet: parseFloat(packet.tankLevelFeet) || 0,
      bblsTaken: parseFloat(packet.bblsTaken) || 0,
      wellDown: packet.wellDown === true || packet.wellDown === "true",
      flowRateDays: packet.flowRateDays
    });
  }

  let totalFlagged = 0;
  let totalDeleted = 0;
  const wellSummary = [];

  for (const [wellName, packets] of Object.entries(wellPackets)) {
    // Sort by timestamp
    packets.sort((a, b) => a.timestamp - b.timestamp);

    // Get well config
    const config = wellConfigData?.[wellName];
    const numTanks = config?.numTanks || 1;
    const bblPerFoot = numTanks * 20;

    // Calculate flow rates and predictions for each packet
    let prevRawFlowRateDays = null;
    const packetsToDelete = [];

    for (let i = 0; i < packets.length; i++) {
      const packet = packets[i];
      const prevPacket = i > 0 ? packets[i - 1] : null;

      // Skip first packet (no prediction possible)
      if (!prevPacket || !prevRawFlowRateDays) {
        // Calculate this packet's flow rate for next iteration
        if (prevPacket) {
          const prevFeetTaken = prevPacket.bblsTaken / bblPerFoot;
          const prevBottomFeet = Math.max(0, prevPacket.tankLevelFeet - prevFeetTaken);
          const recoveryFeet = packet.tankLevelFeet - prevBottomFeet;
          const timeDiffMs = packet.timestamp - prevPacket.timestamp;
          const timeDiffDays = timeDiffMs / (1000 * 60 * 60 * 24);

          if (recoveryFeet > 0 && timeDiffDays > 0) {
            prevRawFlowRateDays = timeDiffDays / recoveryFeet;
          }
        }
        continue;
      }

      // Calculate predicted level using previous flow rate
      const prevFeetTaken = prevPacket.bblsTaken / bblPerFoot;
      const prevBottomFeet = Math.max(0, prevPacket.tankLevelFeet - prevFeetTaken);
      const timeDiffMs = packet.timestamp - prevPacket.timestamp;
      const timeDiffDays = timeDiffMs / (1000 * 60 * 60 * 24);

      if (timeDiffDays > 0 && prevRawFlowRateDays > 0) {
        const growthFeet = timeDiffDays / prevRawFlowRateDays;
        const predictedFeet = prevBottomFeet + growthFeet;
        const actualFeet = packet.tankLevelFeet;

        // Calculate accuracy
        const accuracy = actualFeet > 0 ? predictedFeet / actualFeet : 0;

        if (accuracy < MIN_ACCURACY || accuracy > MAX_ACCURACY) {
          packetsToDelete.push({
            key: packet.key,
            dateTime: packet.dateTime,
            predictedFeet,
            actualFeet,
            accuracy
          });
        }
      }

      // Update flow rate for next iteration
      const recoveryFeet = packet.tankLevelFeet - prevBottomFeet;
      if (recoveryFeet > 0 && timeDiffDays > 0) {
        prevRawFlowRateDays = timeDiffDays / recoveryFeet;
      }
    }

    if (packetsToDelete.length > 0) {
      console.log(`${wellName}: ${packetsToDelete.length} packets to delete (of ${packets.length} total)`);

      for (const pkt of packetsToDelete) {
        const accPct = (pkt.accuracy * 100).toFixed(1);
        console.log(`  ${pkt.dateTime} | pred: ${pkt.predictedFeet.toFixed(1)}ft | actual: ${pkt.actualFeet.toFixed(1)}ft | accuracy: ${accPct}%`);

        if (!DRY_RUN) {
          await firebaseRequest('DELETE', `packets/processed/${pkt.key}`);
          totalDeleted++;
        }
      }
      console.log('');

      totalFlagged += packetsToDelete.length;
      wellSummary.push({ wellName, count: packetsToDelete.length, total: packets.length });
    }
  }

  console.log("=== SUMMARY ===");
  console.log(`Total packets flagged: ${totalFlagged}`);
  if (!DRY_RUN) {
    console.log(`Total packets deleted: ${totalDeleted}`);
  }

  console.log("\nBy well:");
  wellSummary.sort((a, b) => b.count - a.count);
  for (const w of wellSummary) {
    const pct = ((w.count / w.total) * 100).toFixed(1);
    console.log(`  ${w.wellName}: ${w.count}/${w.total} (${pct}%)`);
  }

  if (DRY_RUN) {
    console.log("\n=== Run with --delete flag to actually delete these packets ===");
  }
}

main().catch(console.error);
