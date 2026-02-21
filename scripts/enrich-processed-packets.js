/**
 * Enrich Processed Packets with Flow Rate Data
 *
 * Reads all processed packets and adds enrichment fields:
 * - flowRate, flowRateDays (raw flow rate from this pull)
 * - recoveryInches, recoveryNeeded
 * - tankTopInches, tankAfterInches, tankAfterFeet
 * - timeDif, timeDifDays
 * - estTimeToPull, estDateTimePull
 * - processedAt
 *
 * Run with: node scripts/enrich-processed-packets.js [--write]
 * Without --write flag, does a dry run showing what would be updated
 */

const https = require('https');

const FIREBASE_DATABASE_URL = "wellbuilt-sync-default-rtdb.firebaseio.com";
const FIREBASE_API_KEY = "AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI";

const DRY_RUN = !process.argv.includes('--write');
const FORCE = process.argv.includes('--force');

// HTTP helper for Firebase REST API
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

// Parse packet timestamp
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

// Format days to H:MM:SS string
function formatDaysToHMS(days) {
  if (!days || days <= 0) return "N/A";
  const totalSeconds = Math.round(days * 24 * 60 * 60);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Format days to H:MM string (for timeDif)
function formatDaysToHM(days) {
  if (!days || days <= 0) return "N/A";
  const totalMinutes = Math.round(days * 24 * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

// Convert feet to feet'inches" format
function feetToFeetInches(feet) {
  const wholeFeet = Math.floor(feet);
  const inches = Math.floor((feet - wholeFeet) * 12);
  return `${wholeFeet}'${inches}"`;
}

// Calculate enrichment for a packet given previous packet data
function calculateEnrichment(packet, prevPacket, wellConfig) {
  const numTanks = wellConfig?.numTanks || 1;
  const bblPerFoot = numTanks * 20;
  const pullThreshold = wellConfig?.pullThreshold || 8.0;

  const topLevel = parseFloat(packet.tankLevelFeet) || 0;
  const bblsTaken = parseFloat(packet.bblsTaken) || 0;
  const timestamp = parsePacketTimestamp(packet);

  const enrichment = {
    processedAt: new Date().toISOString()
  };

  // Tank levels in inches
  const tankTopInches = Math.floor(topLevel * 12);
  const feetTaken = bblsTaken / bblPerFoot;
  const tankAfterFeet = Math.max(0, topLevel - feetTaken);
  const tankAfterInches = Math.floor(tankAfterFeet * 12);

  enrichment.tankTopInches = tankTopInches;
  enrichment.tankAfterInches = tankAfterInches;
  enrichment.tankAfterFeet = feetToFeetInches(tankAfterFeet);

  // Recovery needed to reach pull threshold
  const recoveryNeeded = Math.max(0, pullThreshold - tankAfterFeet);
  enrichment.recoveryNeeded = recoveryNeeded;

  // Calculate flow rate from previous packet
  if (prevPacket) {
    const prevTimestamp = parsePacketTimestamp(prevPacket);
    const prevTopLevel = parseFloat(prevPacket.tankLevelFeet) || 0;
    const prevBblsTaken = parseFloat(prevPacket.bblsTaken) || 0;
    const prevFeetTaken = prevBblsTaken / bblPerFoot;
    const prevBottomFeet = Math.max(0, prevTopLevel - prevFeetTaken);

    // Time difference
    const timeDiffMs = timestamp - prevTimestamp;
    const timeDiffDays = timeDiffMs / (1000 * 60 * 60 * 24);

    if (timeDiffDays > 0) {
      enrichment.timeDif = formatDaysToHM(timeDiffDays);
      enrichment.timeDifDays = timeDiffDays;

      // Recovery (how much the tank grew)
      const recoveryFeet = topLevel - prevBottomFeet;
      const recoveryInches = Math.floor(recoveryFeet * 12);
      enrichment.recoveryInches = recoveryInches;

      // Flow rate (days per foot of recovery)
      if (recoveryFeet > 0) {
        const flowRateDays = timeDiffDays / recoveryFeet;
        enrichment.flowRateDays = flowRateDays;
        enrichment.flowRate = formatDaysToHMS(flowRateDays);

        // Estimate time to next pull
        if (recoveryNeeded > 0 && flowRateDays > 0) {
          const daysToThreshold = recoveryNeeded * flowRateDays;
          enrichment.estTimeToPull = formatDaysToHM(daysToThreshold);

          const estPullTime = new Date(timestamp + daysToThreshold * 24 * 60 * 60 * 1000);
          enrichment.estDateTimePull = estPullTime.toISOString();
        }
      }
    }
  }

  return enrichment;
}

async function main() {
  if (DRY_RUN) {
    console.log("=== DRY RUN - No changes will be made ===");
    console.log("Run with --write flag to actually update packets\n");
  } else {
    console.log("=== WRITING ENRICHMENT DATA ===\n");
  }

  console.log("Loading data from Firebase...\n");

  // Fetch all data we need
  const [processedData, wellConfigData] = await Promise.all([
    firebaseRequest('GET', 'packets/processed'),
    firebaseRequest('GET', 'well_config')
  ]);

  if (!processedData) {
    console.log("No processed packets found.");
    return;
  }

  // Group packets by well
  const wellPackets = {};
  let totalPackets = 0;

  for (const [key, packet] of Object.entries(processedData)) {
    // Skip non-pull packets
    // Note: requestType "edit" packets with edit_ prefix are replacement packets
    // that SHOULD be enriched. Only skip wellHistory/performanceReport/delete types,
    // history_ prefixed keys, and wasEdited (superseded by an edit).
    if (packet.requestType === "wellHistory" ||
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
      packet,
      timestamp
    });
    totalPackets++;
  }

  console.log(`Found ${totalPackets} pull packets across ${Object.keys(wellPackets).length} wells.\n`);

  // Process each well
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const [wellName, packets] of Object.entries(wellPackets)) {
    // Sort by timestamp (oldest first)
    packets.sort((a, b) => a.timestamp - b.timestamp);

    // Get well config
    const config = wellConfigData?.[wellName];

    console.log(`Processing ${wellName}: ${packets.length} pulls...`);

    let wellUpdated = 0;
    let wellSkipped = 0;

    // Enrich each packet
    for (let i = 0; i < packets.length; i++) {
      const { key, packet } = packets[i];
      const prevPacket = i > 0 ? packets[i - 1].packet : null;

      // Check if already enriched (has flowRateDays) - skip unless --force
      if (!FORCE && packet.flowRateDays !== undefined && packet.processedAt !== undefined) {
        wellSkipped++;
        continue;
      }

      try {
        const enrichment = calculateEnrichment(packet, prevPacket, config);

        if (!DRY_RUN) {
          // Update the packet with enrichment data
          await firebaseRequest('PATCH', `packets/processed/${key}`, enrichment);
        }

        wellUpdated++;
      } catch (error) {
        console.error(`  Error enriching ${key}: ${error.message}`);
        errorCount++;
      }
    }

    if (wellUpdated > 0 || wellSkipped > 0) {
      console.log(`  Updated: ${wellUpdated}, Already enriched: ${wellSkipped}`);
    }

    updatedCount += wellUpdated;
    skippedCount += wellSkipped;
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Packets updated: ${updatedCount}`);
  console.log(`Packets skipped (already enriched): ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);

  if (DRY_RUN) {
    console.log("\n=== Run with --write flag to actually update these packets ===");
  }
}

main().catch(console.error);
