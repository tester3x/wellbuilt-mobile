/**
 * Backfill Performance Data from packets/processed
 *
 * This script reads all processed packets and writes performance data
 * for each pull. The PREDICTED level uses the RAW FLOW RATE (not AFR)
 * because that's what the driver would have seen at the time of the pull.
 *
 * IMPORTANT: We keep ALL packets in the flow rate chain calculation,
 * but SKIP writing performance rows for packets with bad accuracy.
 * This preserves the chain integrity while filtering out garbage data.
 *
 * Run with: node scripts/backfill-performance.js
 */

const https = require('https');

const FIREBASE_DATABASE_URL = "wellbuilt-sync-default-rtdb.firebaseio.com";
const FIREBASE_API_KEY = "AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI";

// Accuracy bounds - skip writing performance for predictions outside this range
const MIN_ACCURACY = 0.70;  // 70%
const MAX_ACCURACY = 1.50;  // 150%

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

// Parse flow rate string like "7:30:00" to days per foot
function parseFlowRateToDays(flowRateStr) {
  if (!flowRateStr || flowRateStr === "N/A" || flowRateStr === "-") return null;
  const match = flowRateStr.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (match) {
    const hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const seconds = parseInt(match[3]);
    return (hours + minutes / 60 + seconds / 3600) / 24; // days per foot
  }
  return null;
}

async function main() {
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

  // Group packets by well, keeping full packet data for flowRate access
  const wellPackets = {};
  let totalPackets = 0;

  for (const [key, packet] of Object.entries(processedData)) {
    // Skip non-pull packets (but DON'T skip wasEdited - we need them for chain!)
    if (packet.requestType === "edit" ||
        packet.requestType === "wellHistory" ||
        packet.requestType === "performanceReport" ||
        packet.requestType === "delete" ||
        key.startsWith("history_")) {
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
      tankLevelFeet: parseFloat(packet.tankLevelFeet) || 0,
      bblsTaken: parseFloat(packet.bblsTaken) || 0,
      wellDown: packet.wellDown === true || packet.wellDown === "true",
      wasEdited: packet.wasEdited === true,
      dateTimeUTC: packet.dateTimeUTC,
      // Keep raw flow rate data if already calculated
      flowRate: packet.flowRate,
      flowRateDays: packet.flowRateDays
    });
    totalPackets++;
  }

  console.log(`Found ${totalPackets} pull packets across ${Object.keys(wellPackets).length} wells.\n`);
  console.log(`Accuracy bounds: ${MIN_ACCURACY * 100}% - ${MAX_ACCURACY * 100}%\n`);

  // Process each well
  let writtenCount = 0;
  let skippedBadAccuracy = 0;
  let skippedWasEdited = 0;
  let skippedNoFlowRate = 0;
  let errorCount = 0;

  for (const [wellName, packets] of Object.entries(wellPackets)) {
    // Sort by timestamp (oldest first)
    packets.sort((a, b) => a.timestamp - b.timestamp);

    // Get well config
    const config = wellConfigData?.[wellName];
    const numTanks = config?.numTanks || 1;
    const bblPerFoot = numTanks * 20;

    console.log(`Processing ${wellName}: ${packets.length} pulls...`);

    // Track the previous packet's raw flow rate (what driver would have seen)
    // This carries forward from one pull to the next
    let prevRawFlowRateDays = null;

    // Write performance data for each pull
    for (let i = 0; i < packets.length; i++) {
      const packet = packets[i];
      const prevPacket = i > 0 ? packets[i - 1] : null;

      // Skip wasEdited packets (superseded by newer edit) - don't write perf data
      // But still use them for flow rate chain!
      if (packet.wasEdited) {
        // Still calculate this packet's flow rate for the chain
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
        skippedWasEdited++;
        continue;
      }

      try {
        // Get pull time
        const pullTime = packet.dateTimeUTC ? new Date(packet.dateTimeUTC) : new Date(packet.timestamp);
        const rowKey = `${pullTime.getFullYear()}${String(pullTime.getMonth() + 1).padStart(2, "0")}${String(pullTime.getDate()).padStart(2, "0")}_${String(pullTime.getHours()).padStart(2, "0")}${String(pullTime.getMinutes()).padStart(2, "0")}${String(pullTime.getSeconds()).padStart(2, "0")}`;
        const dateStr = `${pullTime.getFullYear()}-${String(pullTime.getMonth() + 1).padStart(2, "0")}-${String(pullTime.getDate()).padStart(2, "0")}`;

        // Actual level in inches (what driver found)
        const actualInches = Math.floor(packet.tankLevelFeet * 12);

        // Calculate predicted level using RAW flow rate (what driver would have seen)
        let predictedInches = actualInches; // Default to actual if can't calculate
        let hasPrediction = false;

        if (prevPacket && prevRawFlowRateDays && prevRawFlowRateDays > 0) {
          // We have a previous flow rate - use it to predict
          const prevFeetTaken = prevPacket.bblsTaken / bblPerFoot;
          const prevBottomFeet = Math.max(0, prevPacket.tankLevelFeet - prevFeetTaken);

          const timeDiffMs = packet.timestamp - prevPacket.timestamp;
          const timeDiffDays = timeDiffMs / (1000 * 60 * 60 * 24);

          if (timeDiffDays > 0) {
            // Predicted = previous bottom + growth using previous raw flow rate
            const growthFeet = timeDiffDays / prevRawFlowRateDays;
            const predictedFeet = prevBottomFeet + growthFeet;
            predictedInches = Math.floor(predictedFeet * 12);
            hasPrediction = true;
          }
        }

        // Now calculate THIS packet's raw flow rate for the NEXT iteration
        let thisRawFlowRateDays = null;

        if (packet.flowRateDays && packet.flowRateDays > 0) {
          // Already calculated and stored - use it
          thisRawFlowRateDays = packet.flowRateDays;
        } else if (packet.flowRate) {
          // Parse from string format
          thisRawFlowRateDays = parseFlowRateToDays(packet.flowRate);
        }

        // If not in packet, calculate from previous packet
        if (!thisRawFlowRateDays && prevPacket) {
          const prevFeetTaken = prevPacket.bblsTaken / bblPerFoot;
          const prevBottomFeet = Math.max(0, prevPacket.tankLevelFeet - prevFeetTaken);
          const recoveryFeet = packet.tankLevelFeet - prevBottomFeet;

          if (recoveryFeet > 0) {
            const timeDiffMs = packet.timestamp - prevPacket.timestamp;
            const timeDiffDays = timeDiffMs / (1000 * 60 * 60 * 24);

            if (timeDiffDays > 0) {
              thisRawFlowRateDays = timeDiffDays / recoveryFeet;
            }
          }
        }

        // Update flow rate for next iteration
        if (thisRawFlowRateDays && thisRawFlowRateDays > 0) {
          prevRawFlowRateDays = thisRawFlowRateDays;
        }

        // Skip impossible actual levels (>20 feet = 240 inches is impossible for a tank)
        if (actualInches > 240) {
          skippedBadAccuracy++;
          continue;
        }

        // Check accuracy bounds before writing
        if (hasPrediction && actualInches > 0) {
          const accuracy = predictedInches / actualInches;
          if (accuracy < MIN_ACCURACY || accuracy > MAX_ACCURACY) {
            skippedBadAccuracy++;
            continue; // Skip this row but keep flow rate chain intact
          }
        } else if (!hasPrediction && i > 0) {
          // No prediction possible (no previous flow rate) - skip
          skippedNoFlowRate++;
          continue;
        }

        // Write to Firebase
        const wellKey = wellName.replace(/\s+/g, "_");
        const perfData = { d: dateStr, a: actualInches, p: predictedInches };

        await firebaseRequest('PUT', `performance/${wellKey}/rows/${rowKey}`, perfData);
        writtenCount++;

      } catch (error) {
        console.error(`  Error writing ${packet.key}: ${error.message}`);
        errorCount++;
      }
    }

    // Update well metadata
    const wellKey = wellName.replace(/\s+/g, "_");
    await firebaseRequest('PUT', `performance/${wellKey}/wellName`, wellName);
    await firebaseRequest('PUT', `performance/${wellKey}/updated`, new Date().toISOString());
  }

  console.log(`\nBackfill complete!`);
  console.log(`  Written: ${writtenCount} performance rows`);
  console.log(`  Skipped (bad accuracy): ${skippedBadAccuracy}`);
  console.log(`  Skipped (wasEdited): ${skippedWasEdited}`);
  console.log(`  Skipped (no flow rate): ${skippedNoFlowRate}`);
  console.log(`  Errors: ${errorCount}`);
}

main().catch(console.error);
