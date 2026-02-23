/**
 * WellBuilt Firebase Cloud Functions
 *
 * PRIMARY processing for all incoming packets:
 * - Monitors packets/incoming for new pull/edit packets
 * - Calculates response immediately using full AFR algorithm
 * - Writes response to packets/outgoing so app gets instant data
 * - Moves packet to packets/processed for VBA to read
 * - Increments packets/processed_version so VBA knows to check
 *
 * VBA's role is now:
 * - Poll processed_version (not incoming_version)
 * - Read packets from processed/ to update Excel sheets
 * - Write performance data for analytics
 * - Handle wellHistory requests (needs Excel data)
 *
 * Excel heartbeat (status/excel_heartbeat) is still used to:
 * - Let app know if Excel-dependent features are available
 * - Show "WellBuilt down for maintenance" when Excel is offline
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.database();

// Default tank height and bbl per tank
const DEFAULT_TANK_HEIGHT_FEET = 16;
const BBL_PER_TANK = 20; // 20 bbl per foot per tank

// AFR Algorithm constants
const AFR_WINDOW_SIZES = [3, 4, 5, 6, 7]; // Test these window sizes
const STEP_THRESHOLD = 0.10; // 10% deviation triggers step detection (matches VBA)
const STEP_PULLS = 3; // Number of consecutive pulls to check for step
const ANOMALY_RATIO = 5.0; // >5x or <0.2x median is anomaly (matches VBA)
const TREND_THRESHOLD = 0.05; // 5% deviation for trend detection
const TREND_PULLS = 5; // Number of pulls to check for trend
const TREND_MIN_COUNT = 4; // At least 4 of 5 must be in same direction

// VBA heartbeat timeout (2 minutes)
const VBA_HEARTBEAT_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Parse packet timestamp consistently - handles both UTC and local time strings
 * Always returns a UTC timestamp in milliseconds
 *
 * @param {object} packet - Packet with dateTimeUTC and/or dateTime fields
 * @returns {number} Timestamp in milliseconds, or NaN if unparseable
 */
function parsePacketTimestamp(packet) {
  // Prefer dateTimeUTC (ISO 8601 format) - always correct
  if (packet.dateTimeUTC) {
    return new Date(packet.dateTimeUTC).getTime();
  }

  // Fall back to dateTime (local time string like "1/28/2026 10:00 AM")
  if (packet.dateTime) {
    const localTimeStr = packet.dateTime;

    // Try to parse the local time string
    // Format is typically "M/D/YYYY H:MM:SS AM/PM" or "M/D/YYYY H:MM AM/PM"
    const match = localTimeStr.match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+)(?::(\d+))?\s*(AM|PM)?/i);
    if (match) {
      let [, month, day, year, hours, minutes, seconds, ampm] = match;
      let h = parseInt(hours);
      if (ampm) {
        if (ampm.toUpperCase() === "PM" && h !== 12) h += 12;
        if (ampm.toUpperCase() === "AM" && h === 12) h = 0;
      }
      // Create date as local time
      // Note: This creates the date in Cloud Functions' timezone (UTC)
      // For packets without dateTimeUTC, this is the best we can do
      // Most packets should have dateTimeUTC now, so this is legacy fallback
      const localDate = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        h,
        parseInt(minutes),
        parseInt(seconds || "0")
      );
      return localDate.getTime();
    }

    // Last resort: try native parsing
    return new Date(localTimeStr).getTime();
  }

  return NaN;
}

/**
 * Check if VBA/Excel is online by checking heartbeat timestamp
 * Returns true if heartbeat is within timeout, false otherwise
 */
async function isVbaOnline() {
  try {
    const snapshot = await db.ref("status/excel_heartbeat").once("value");
    const heartbeat = snapshot.val();

    if (!heartbeat || !heartbeat.timestamp) {
      console.log("No VBA heartbeat found - VBA is offline");
      return false;
    }

    // Parse the ISO timestamp
    const heartbeatTime = new Date(heartbeat.timestamp).getTime();
    const now = Date.now();
    const age = now - heartbeatTime;

    const isOnline = age < VBA_HEARTBEAT_TIMEOUT_MS;
    console.log(`VBA heartbeat age: ${Math.round(age / 1000)}s - ${isOnline ? "ONLINE" : "OFFLINE"}`);

    return isOnline;
  } catch (error) {
    console.error("Error checking VBA heartbeat:", error);
    return false; // Assume offline if we can't check
  }
}

/**
 * Get well config from Firebase /well_config
 */
async function getWellConfigFromFirebase(wellName) {
  try {
    const snapshot = await db.ref(`well_config/${wellName}`).once("value");
    const config = snapshot.val();

    if (!config) {
      console.log(`No config found for well: ${wellName}`);
      return null;
    }

    const numTanks = config.numTanks || 1;
    const bblPerFoot = BBL_PER_TANK * numTanks;

    return {
      numTanks: numTanks,
      bblPerFoot: bblPerFoot,
      tankHeight: DEFAULT_TANK_HEIGHT_FEET,
      loadLine: config.loadLine || 0,
      allowedBottom: config.allowedBottom || 3,
      pullBbls: config.pullBbls || 140,
      avgFlowRateMinutes: config.avgFlowRateMinutes || 0  // Fallback flow rate if no history
    };
  } catch (error) {
    console.error(`Error fetching well config for ${wellName}:`, error);
    return null;
  }
}

/**
 * Get the most recent pull packet for a well from packets/processed
 * Used after edits to calculate response from current state, not edited row
 * Returns the packet data or null if not found
 */
async function getMostRecentPullPacket(wellName) {
  try {
    const snapshot = await db.ref("packets/processed")
      .orderByChild("wellName")
      .equalTo(wellName)
      .limitToLast(50)
      .once("value");

    const packets = snapshot.val();
    if (!packets) {
      console.log(`No packets found for ${wellName}`);
      return null;
    }

    // Find the most recent non-edit packet by timestamp
    let mostRecent = null;
    let mostRecentTime = 0;

    for (const [key, packet] of Object.entries(packets)) {
      // Skip edit packets and non-pull packets
      if (packet.requestType === "edit" || packet.requestType === "wellHistory") {
        continue;
      }

      // Parse timestamp consistently (handles both UTC and local formats)
      const timestamp = parsePacketTimestamp(packet);

      if (isNaN(timestamp)) continue;

      if (timestamp > mostRecentTime) {
        mostRecentTime = timestamp;
        mostRecent = packet;
      }
    }

    if (mostRecent) {
      console.log(`Most recent packet for ${wellName}: ${mostRecent.dateTimeUTC || mostRecent.dateTime}`);
    }

    return mostRecent;
  } catch (error) {
    console.error(`Error fetching most recent packet for ${wellName}:`, error);
    return null;
  }
}

/**
 * Get historical pull data for AFR calculation from packets/processed
 * Returns array of {timestamp, flowRateDays, tankTopInches, tankAfterInches, timeDiffDays}
 */
async function getHistoricalPulls(wellName, limit = 50) {
  try {
    // Query processed packets for this well
    // NOTE: Don't use limitToLast() here - Firebase sorts by key alphabetically,
    // not by timestamp. This causes history_* packets (wellHistory requests) to
    // be returned instead of actual pull packets for wells with many history requests.
    // Instead, we fetch all packets and filter/limit in code.
    const snapshot = await db.ref("packets/processed")
      .orderByChild("wellName")
      .equalTo(wellName)
      .once("value");

    const packets = snapshot.val();
    if (!packets) {
      console.log(`No historical packets found for ${wellName}`);
      return [];
    }

    // Convert to array, filtering out non-pull packets
    const pulls = [];
    for (const [key, packet] of Object.entries(packets)) {
      // Skip:
      // - requestType "wellHistory" (history requests, not pull data)
      // - history_ prefixed keys (wellHistory requests)
      // - wasEdited === true (superseded packets - the edit replaces this)
      // Note: requestType "edit" packets with edit_ prefix are replacement packets
      // that SHOULD be included in the pull chain for accurate flow rate calculation.
      if (packet.requestType === "wellHistory" ||
          key.startsWith("history_") ||
          packet.wasEdited === true) {
        continue;
      }

      // Parse timestamp consistently (handles both UTC and local formats)
      const timestamp = parsePacketTimestamp(packet);

      if (isNaN(timestamp)) continue;

      const tankLevelFeet = parseFloat(packet.tankLevelFeet) || 0;
      const bblsTaken = parseFloat(packet.bblsTaken) || 0;
      const wellDown = packet.wellDown === true || packet.wellDown === "true";

      pulls.push({
        key,
        timestamp,
        tankLevelFeet,
        bblsTaken,
        wellDown
      });
    }

    // Sort by timestamp ascending (oldest first)
    pulls.sort((a, b) => a.timestamp - b.timestamp);

    // Take only the most recent 'limit' pulls for AFR calculation
    const recentPulls = pulls.slice(-limit);

    console.log(`Found ${pulls.length} total pulls for ${wellName}, using last ${recentPulls.length} for AFR`);
    return recentPulls;
  } catch (error) {
    console.error(`Error fetching historical pulls for ${wellName}:`, error);
    return [];
  }
}

/**
 * Calculate flow rate data from historical pulls
 * This mimics VBA's Column H calculation: (timeDiff / recoveryInches) * 12 = days per foot
 */
function calculateFlowRates(pulls, bblPerFoot) {
  const flowData = [];

  for (let i = 1; i < pulls.length; i++) {
    const current = pulls[i];
    const prev = pulls[i - 1];

    // Skip if well was down
    if (current.wellDown) continue;

    // Calculate tank after for previous pull
    const prevFeetTaken = prev.bblsTaken / bblPerFoot;
    const prevTankAfter = Math.max(0, prev.tankLevelFeet - prevFeetTaken);

    // Recovery = current tank top - previous tank after
    const recoveryFeet = current.tankLevelFeet - prevTankAfter;
    if (recoveryFeet <= 0) continue;

    // Time difference in days
    const timeDiffMs = current.timestamp - prev.timestamp;
    const timeDiffDays = timeDiffMs / (1000 * 60 * 60 * 24);
    if (timeDiffDays <= 0) continue;

    // Flow rate = time / recovery (days per foot)
    const flowRateDays = timeDiffDays / recoveryFeet;

    flowData.push({
      timestamp: current.timestamp,
      flowRateDays,
      tankTopFeet: current.tankLevelFeet,
      prevTankAfterFeet: prevTankAfter,
      timeDiffDays,
      recoveryFeet
    });
  }

  return flowData;
}

/**
 * Get Adaptive Flow Rate (AFR) - ports VBA's GetAverageFlowRate
 *
 * Algorithm (matches VBA):
 * 1. ANOMALY FILTERING: Calculate median, filter out rates >5x or <0.2x median
 * 2. Test window sizes 3-7 to find the one with lowest prediction error
 * 3. STEP DETECTION: If last 3 pulls ALL >10% off in same direction, use median of last 3
 * 4. TREND DETECTION: If 4 of 5 last pulls >5% off in same direction, use median of last 3
 * 5. Otherwise use best window average
 *
 * Returns flow rate in days per foot
 */
function getAdaptiveFlowRate(flowData, wellName = "unknown") {
  if (!flowData || flowData.length < 3) {
    // Not enough data - return most recent or 0
    if (flowData && flowData.length > 0) {
      console.log(`AFR[${wellName}]: Only ${flowData.length} pulls, using most recent: ${flowData[flowData.length - 1].flowRateDays.toFixed(4)} days/ft`);
      return flowData[flowData.length - 1].flowRateDays;
    }
    console.log(`AFR[${wellName}]: No flow data available`);
    return 0;
  }

  // ===== PHASE 1: ANOMALY FILTERING (like VBA) =====
  // Calculate median of all flow rates
  const allRates = flowData.map(d => d.flowRateDays).sort((a, b) => a - b);
  const midIdx = Math.floor(allRates.length / 2);
  const median = allRates.length % 2 === 1
    ? allRates[midIdx]
    : (allRates[midIdx - 1] + allRates[midIdx]) / 2;

  // Filter out anomalies (>5x or <0.2x median)
  const minValid = median / ANOMALY_RATIO;
  const maxValid = median * ANOMALY_RATIO;

  const validFlowData = flowData.filter(d => {
    const isValid = d.flowRateDays >= minValid && d.flowRateDays <= maxValid;
    if (!isValid) {
      const rateHrs = d.flowRateDays * 24;
      const ratio = d.flowRateDays > median ? d.flowRateDays / median : median / d.flowRateDays;
      console.log(`AFR[${wellName}]: ANOMALY FILTERED - ${rateHrs.toFixed(2)}hrs/ft (${ratio.toFixed(1)}x off median)`);
    }
    return isValid;
  });

  // Need at least 3 valid pulls after filtering
  if (validFlowData.length < 3) {
    console.log(`AFR[${wellName}]: Only ${validFlowData.length} valid pulls after anomaly filter, using most recent valid`);
    if (validFlowData.length > 0) {
      return validFlowData[validFlowData.length - 1].flowRateDays;
    }
    // Fall back to unfiltered most recent if all are anomalies
    return flowData[flowData.length - 1].flowRateDays;
  }

  const pullCount = validFlowData.length;

  // Log last 5 valid flow rates for debugging
  console.log(`AFR[${wellName}]: ${flowData.length} total, ${pullCount} valid after anomaly filter (median=${(median * 24).toFixed(2)}hrs/ft)`);
  const recentCount = Math.min(5, pullCount);
  for (let i = pullCount - recentCount; i < pullCount; i++) {
    const fd = validFlowData[i];
    const rateHrs = fd.flowRateDays * 24;
    const rateHMS = `${Math.floor(rateHrs)}:${String(Math.floor((rateHrs % 1) * 60)).padStart(2, '0')}`;
    console.log(`  [${i}] ${rateHMS}/ft (${fd.flowRateDays.toFixed(4)} days) | recovery=${fd.recoveryFeet.toFixed(2)}ft | timeDiff=${(fd.timeDiffDays * 24).toFixed(2)}hrs`);
  }

  // ===== PHASE 2: Test each window size to find optimal =====
  let bestWindowSize = 5;
  let lowestError = Infinity;

  for (const windowSize of AFR_WINDOW_SIZES) {
    // Need enough history to test this window
    if (pullCount < windowSize + 2) continue;

    // Test on last 5 pulls (or fewer if not enough data)
    const testStart = Math.max(windowSize, pullCount - 5);
    const testEnd = pullCount - 1;

    let testError = 0;
    let testCount = 0;

    for (let j = testStart; j <= testEnd; j++) {
      // Calculate average flow rate using 'windowSize' pulls before this one
      let flowSum = 0;
      let flowCnt = 0;

      for (let k = j - windowSize; k < j; k++) {
        if (k >= 0) {
          flowSum += validFlowData[k].flowRateDays;
          flowCnt++;
        }
      }

      if (flowCnt === 0) continue;

      const avgFlow = flowSum / flowCnt;

      // Predict level: prevTankAfter + (timeDiff / flowRate)
      const predicted = validFlowData[j].prevTankAfterFeet +
        (validFlowData[j].timeDiffDays / avgFlow);
      const actual = validFlowData[j].tankTopFeet;

      testError += Math.abs(predicted - actual);
      testCount++;
    }

    // Calculate average error for this window size
    if (testCount > 0) {
      const avgError = testError / testCount;
      if (avgError < lowestError) {
        lowestError = avgError;
        bestWindowSize = windowSize;
      }
    }
  }

  // ===== PHASE 3: STEP DETECTION =====
  // Check if last 3 pulls are ALL >10% off from pre-step average in same direction
  if (pullCount >= STEP_PULLS + bestWindowSize) {
    // Calculate pre-step AFR from pulls BEFORE the last 3
    let flowSum = 0;
    let flowCnt = 0;

    for (let j = pullCount - STEP_PULLS - bestWindowSize; j < pullCount - STEP_PULLS; j++) {
      if (j >= 0) {
        flowSum += validFlowData[j].flowRateDays;
        flowCnt++;
      }
    }

    if (flowCnt > 0) {
      const preStepAFR = flowSum / flowCnt;

      // Get last 3 rates
      const recentRates = [];
      for (let j = pullCount - STEP_PULLS; j < pullCount; j++) {
        recentRates.push(validFlowData[j].flowRateDays);
      }

      // Check if all 3 are in same direction beyond threshold
      let allHigher = true;
      let allLower = true;

      for (const rate of recentRates) {
        const deviation = (rate - preStepAFR) / preStepAFR;
        if (deviation <= STEP_THRESHOLD) allHigher = false;
        if (deviation >= -STEP_THRESHOLD) allLower = false;
      }

      // If all 3 are in same direction beyond threshold, use median of last 3
      if (allHigher || allLower) {
        // Sort and take median
        recentRates.sort((a, b) => a - b);
        const medianRate = recentRates[1];
        const medianHrs = medianRate * 24;
        const medianHMS = `${Math.floor(medianHrs)}:${String(Math.floor((medianHrs % 1) * 60)).padStart(2, '0')}:${String(Math.floor(((medianHrs % 1) * 60 % 1) * 60)).padStart(2, '0')}`;
        console.log(`AFR[${wellName}]: STEP DETECTED (${allHigher ? 'slower' : 'faster'})! preStepAFR=${(preStepAFR * 24).toFixed(2)}hrs, median of last 3 = ${medianHMS}/ft (${medianRate.toFixed(6)} days)`);
        return medianRate;
      }
    }
  }

  // ===== PHASE 3B: TREND DETECTION (like VBA) =====
  // If 4 of 5 last pulls are >5% off in same direction, use median of last 3
  if (pullCount >= TREND_PULLS + bestWindowSize) {
    // Calculate base AFR from pulls BEFORE the trend window
    let flowSum = 0;
    let flowCnt = 0;

    for (let j = pullCount - TREND_PULLS - bestWindowSize; j < pullCount - TREND_PULLS; j++) {
      if (j >= 0) {
        flowSum += validFlowData[j].flowRateDays;
        flowCnt++;
      }
    }

    if (flowCnt > 0) {
      const trendBaseAFR = flowSum / flowCnt;
      let trendHigherCount = 0;
      let trendLowerCount = 0;

      // Check last TREND_PULLS pulls
      for (let j = pullCount - TREND_PULLS; j < pullCount; j++) {
        const deviation = (validFlowData[j].flowRateDays - trendBaseAFR) / trendBaseAFR;
        if (deviation > TREND_THRESHOLD) trendHigherCount++;
        if (deviation < -TREND_THRESHOLD) trendLowerCount++;
      }

      // If at least 4 of 5 are in same direction, trend detected
      if (trendHigherCount >= TREND_MIN_COUNT || trendLowerCount >= TREND_MIN_COUNT) {
        // Use median of last 3 pulls
        const trendRates = [
          validFlowData[pullCount - 3].flowRateDays,
          validFlowData[pullCount - 2].flowRateDays,
          validFlowData[pullCount - 1].flowRateDays
        ].sort((a, b) => a - b);

        const trendMedian = trendRates[1];
        const trendHrs = trendMedian * 24;
        const trendHMS = `${Math.floor(trendHrs)}:${String(Math.floor((trendHrs % 1) * 60)).padStart(2, '0')}:${String(Math.floor(((trendHrs % 1) * 60 % 1) * 60)).padStart(2, '0')}`;
        console.log(`AFR[${wellName}]: TREND DETECTED (${trendHigherCount >= TREND_MIN_COUNT ? 'slower' : 'faster'})! base=${(trendBaseAFR * 24).toFixed(2)}hrs, median of last 3 = ${trendHMS}/ft`);
        return trendMedian;
      }
    }
  }

  // ===== PHASE 4: Standard adaptive average (no step or trend detected) =====
  let flowSum = 0;
  let flowCnt = 0;

  for (let j = pullCount - bestWindowSize; j < pullCount; j++) {
    if (j >= 0) {
      flowSum += validFlowData[j].flowRateDays;
      flowCnt++;
    }
  }

  if (flowCnt > 0) {
    const avgRate = flowSum / flowCnt;
    const avgHrs = avgRate * 24;
    const avgHMS = `${Math.floor(avgHrs)}:${String(Math.floor((avgHrs % 1) * 60)).padStart(2, '0')}:${String(Math.floor(((avgHrs % 1) * 60 % 1) * 60)).padStart(2, '0')}`;
    console.log(`AFR[${wellName}]: Using window=${bestWindowSize}, pulls=${flowCnt}, error=${lowestError.toFixed(4)}ft => ${avgHMS}/ft (${avgRate.toFixed(6)} days)`);
    return avgRate;
  }

  // Fallback to most recent valid
  const fallbackRate = validFlowData[pullCount - 1].flowRateDays;
  console.log(`AFR[${wellName}]: FALLBACK to most recent valid: ${fallbackRate.toFixed(6)} days/ft`);
  return fallbackRate;
}

/**
 * Format feet as feet'inches" string
 * Uses floor to only show a full inch when actually reached
 */
function formatLevel(feet) {
  // Add small epsilon to handle floating point precision (e.g., 61.9999... → 62)
  const totalInches = Math.floor(feet * 12 + 0.0001);
  const ft = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${ft}'${inches}"`;
}

/**
 * Format days as H:MM:SS string (time per foot)
 */
function formatFlowRate(daysPerFoot) {
  if (!daysPerFoot || daysPerFoot <= 0) return "N/A";

  const totalSeconds = Math.round(daysPerFoot * 86400);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Format days as H:MM string (time to fill)
 */
function formatTimeTillPull(days) {
  if (!days || days <= 0) return "0:00";

  const totalMinutes = Math.round(days * 24 * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${hours}:${minutes.toString().padStart(2, "0")}`;
}

/**
 * Calculate raw flow rate enrichment data for a processed packet
 * This adds the same fields VBA used to add: flowRate, flowRateDays, recoveryInches, etc.
 * These are the RAW values for THIS pull (not AFR averages)
 *
 * @param packet - The current pull packet
 * @param wellConfig - Well configuration
 * @param historicalPulls - Array of historical pulls (sorted oldest first)
 * @param response - The calculated response (has bottomLevel, etc.)
 * @returns Object with enrichment fields, or empty object if can't calculate
 */
function calculatePacketEnrichment(packet, wellConfig, historicalPulls, response) {
  try {
    const topLevel = parseFloat(packet.tankLevelFeet) || 0;
    const bblsTaken = parseFloat(packet.bblsTaken) || 0;
    const bblPerFoot = wellConfig.bblPerFoot || 20;

    // Tank after = bottom level after this pull
    const tankAfterFeet = Math.max(topLevel - (bblsTaken / bblPerFoot), 0);
    const tankAfterInches = Math.floor(tankAfterFeet * 12);
    const tankTopInches = Math.floor(topLevel * 12);

    // Get current pull timestamp
    const currentTime = packet.dateTimeUTC
      ? new Date(packet.dateTimeUTC).getTime()
      : new Date().getTime();

    // Find previous pull (newest that's older than current)
    // historicalPulls is sorted oldest-first, so iterate to find the LAST one before currentTime
    let prevPull = null;
    for (const pull of historicalPulls) {
      if (pull.timestamp < currentTime) {
        prevPull = pull;
      } else {
        break;
      }
    }

    const enrichment = {
      tankTopInches,
      tankAfterInches,
      tankAfterFeet: formatLevel(tankAfterFeet),
    };

    if (prevPull) {
      // Calculate time difference
      const timeDiffMs = currentTime - prevPull.timestamp;
      const timeDiffDays = timeDiffMs / (1000 * 60 * 60 * 24);
      const timeDiffHours = timeDiffDays * 24;
      const timeDiffHrs = Math.floor(timeDiffHours);
      const timeDiffMins = Math.round((timeDiffHours - timeDiffHrs) * 60);

      // Previous bottom level
      const prevFeetTaken = prevPull.bblsTaken / bblPerFoot;
      const prevBottomFeet = Math.max(prevPull.tankLevelFeet - prevFeetTaken, 0);

      // Recovery = how much level rose since last pull
      const recoveryFeet = topLevel - prevBottomFeet;
      const recoveryInches = Math.round(recoveryFeet * 12);

      enrichment.timeDif = `${timeDiffHrs}:${String(timeDiffMins).padStart(2, "0")}`;
      enrichment.timeDifDays = timeDiffDays;

      if (recoveryFeet > 0) {
        // Raw flow rate = time / recovery (days per foot)
        const flowRateDays = timeDiffDays / recoveryFeet;
        const flowRate = formatFlowRate(flowRateDays);

        enrichment.recoveryInches = recoveryInches;
        enrichment.flowRate = flowRate;
        enrichment.flowRateDays = flowRateDays;
      }
    }

    // Add predicted time fields from response
    if (response) {
      if (response.timeTillPull && response.timeTillPull !== "N/A") {
        enrichment.estTimeToPull = response.timeTillPull;
      }
      if (response.nextPullTimeUTC) {
        enrichment.estDateTimePull = response.nextPullTimeUTC;
      }
    }

    // Calculate recoveryNeeded (feet needed to reach target pull level)
    // Target = (pullBbls / numTanks) / 20 + allowedBottom
    const numTanks = wellConfig.numTanks || 1;
    const pullBbls = wellConfig.pullBbls || 140;
    const allowedBottom = wellConfig.allowedBottom || 2;
    const bblsPerTank = pullBbls / numTanks;
    const targetFeet = (bblsPerTank / 20) + allowedBottom;
    const recoveryNeeded = Math.max(0, targetFeet - tankAfterFeet);
    if (recoveryNeeded > 0) {
      enrichment.recoveryNeeded = recoveryNeeded;
    }

    return enrichment;
  } catch (error) {
    console.error(`Error calculating packet enrichment:`, error);
    return {};
  }
}

/**
 * Write performance data for a pull to Firebase
 * This allows the Performance screen to show data without VBA dependency
 *
 * Format: performance/{wellKey}/rows/{timestamp} = { d: "yyyy-mm-dd", a: actual_inches, p: predicted_inches }
 * - d = date in yyyy-mm-dd format
 * - a = actual level in inches (what driver found - top level before pull)
 * - p = predicted level in inches (WHAT THE DRIVER SAW on screen before pulling)
 *
 * CRITICAL: The predicted level MUST match what was displayed to the driver.
 * This is calculated from the PREVIOUS response (which the driver was looking at)
 * using ITS flow rate and bottom level, projected forward to the current pull time.
 * We do NOT recalculate with the new AFR - that would show a different number than
 * what the driver saw, making accuracy tracking meaningless.
 *
 * @param packet - The current pull packet
 * @param wellConfig - Well configuration
 * @param prevResponse - The PREVIOUS response (captured BEFORE it gets deleted) - what driver saw
 */
async function writePerformanceData(packet, wellConfig, prevResponse) {
  try {
    const wellName = packet.wellName;
    const wellKey = wellName.replace(/\s+/g, "_");
    const topLevel = parseFloat(packet.tankLevelFeet) || 0;

    // Get timestamp for the row key (yyyymmdd_hhmmss format)
    const pullTime = packet.dateTimeUTC ? new Date(packet.dateTimeUTC) : new Date();
    const timestamp = `${pullTime.getFullYear()}${String(pullTime.getMonth() + 1).padStart(2, "0")}${String(pullTime.getDate()).padStart(2, "0")}_${String(pullTime.getHours()).padStart(2, "0")}${String(pullTime.getMinutes()).padStart(2, "0")}${String(pullTime.getSeconds()).padStart(2, "0")}`;

    // Date in yyyy-mm-dd format
    const dateStr = `${pullTime.getFullYear()}-${String(pullTime.getMonth() + 1).padStart(2, "0")}-${String(pullTime.getDate()).padStart(2, "0")}`;

    // Actual level in inches (what driver found)
    const actualInches = Math.floor(topLevel * 12);

    // BEST: Use predictedLevelInches from packet if available
    // This is what the driver actually saw on the pull form - single source of truth
    let predictedInches;

    if (packet.predictedLevelInches !== undefined && packet.predictedLevelInches !== null) {
      // App sent the predicted level directly - use it (no server-side math needed)
      predictedInches = packet.predictedLevelInches;
      console.log(`[Performance] ${wellName}: Using packet's predictedLevelInches=${predictedInches}in, actual=${actualInches}in`);
    } else if (prevResponse && prevResponse.currentLevel && prevResponse.flowRate && prevResponse.flowRate !== "N/A") {
      // FALLBACK: Calculate from previous response (for old packets or backfill)
      // Parse current level from previous response (format: "5'3\"")
      const levelMatch = prevResponse.currentLevel.match(/(\d+)'(\d+)"/);
      if (levelMatch) {
        const prevBottomFeet = parseInt(levelMatch[1]) + parseInt(levelMatch[2]) / 12;

        // Parse flow rate from previous response (format: "H:MM:SS" per foot)
        const flowMatch = prevResponse.flowRate.match(/^(\d+):(\d{2}):(\d{2})$/);
        if (flowMatch) {
          const hours = parseInt(flowMatch[1]);
          const minutes = parseInt(flowMatch[2]);
          const seconds = parseInt(flowMatch[3]);
          const afrDays = (hours + minutes / 60 + seconds / 3600) / 24; // days per foot

          // Time since previous response (this is what the app uses for live calculation)
          const prevTimestamp = prevResponse.timestampUTC || prevResponse.timestamp;
          if (prevTimestamp && afrDays > 0) {
            const prevTime = new Date(prevTimestamp).getTime();
            const currentTime = pullTime.getTime();
            const timeDiffMs = currentTime - prevTime;
            const timeDiffDays = timeDiffMs / (1000 * 60 * 60 * 24);

            if (timeDiffDays > 0) {
              // Growth = time / AFR (feet) - this is exactly how the app calculates live level
              const growthFeet = timeDiffDays / afrDays;
              const predictedFeet = prevBottomFeet + growthFeet;
              predictedInches = Math.floor(predictedFeet * 12);

              console.log(`[Performance] ${wellName}: Calculated from prevResponse bottom=${prevBottomFeet.toFixed(2)}ft, flowRate=${prevResponse.flowRate}, growth=${growthFeet.toFixed(2)}ft (${timeDiffDays.toFixed(2)}days), predicted=${predictedInches}in, actual=${actualInches}in`);
            }
          }
        }
      }
    }

    // Default to actual if we couldn't determine predicted
    if (predictedInches === undefined) {
      predictedInches = actualInches;
      console.log(`[Performance] ${wellName}: No prediction available, using actual=${actualInches}in`);
    }

    // Write to Firebase performance path
    const perfData = {
      d: dateStr,
      a: actualInches,
      p: predictedInches
    };

    await db.ref(`performance/${wellKey}/rows/${timestamp}`).set(perfData);

    // Update the well's metadata
    await db.ref(`performance/${wellKey}/wellName`).set(wellName);
    await db.ref(`performance/${wellKey}/updated`).set(new Date().toISOString());

    console.log(`[Performance] Wrote data for ${wellName}: ${JSON.stringify(perfData)}`);
  } catch (error) {
    console.error(`[Performance] Error writing data for ${packet.wellName}:`, error);
    // Don't throw - performance data is non-critical
  }
}

// ========== BBLs/Day Calculation Functions ==========

/**
 * Get the 6am-6am window end for a given timestamp.
 * Matches the app's history screen windowing logic (firebase.ts:698-710).
 * Before 6am → window ends at 6am same day.
 * 6am or after → window ends at 6am next day.
 */
function getWindowEnd(timestampMs) {
  // Convert to CST/CDT (America/Chicago) to match device-side 6am windows
  const cstOffset = getCSTOffset(timestampMs);
  const localMs = timestampMs + cstOffset;
  const localDate = new Date(localMs);
  const hour = localDate.getUTCHours();
  // Build 6am in local time, then convert back to UTC ms
  const sixAmLocal = new Date(localDate);
  sixAmLocal.setUTCHours(6, 0, 0, 0);
  const sixAmUtc = sixAmLocal.getTime() - cstOffset;
  if (hour < 6) {
    return sixAmUtc;
  } else {
    return sixAmUtc + 24 * 60 * 60 * 1000;
  }
}

/**
 * Get CST/CDT offset in milliseconds (negative for behind UTC).
 * CST = UTC-6 = -21600000ms, CDT = UTC-5 = -18000000ms.
 * US Central: 2nd Sunday of March to 1st Sunday of November.
 */
function getCSTOffset(timestampMs) {
  const date = new Date(timestampMs);
  const year = date.getUTCFullYear();
  // 2nd Sunday of March
  const marchFirst = new Date(Date.UTC(year, 2, 1));
  const marchSecondSun = new Date(Date.UTC(year, 2, 8 + (7 - marchFirst.getUTCDay()) % 7, 8)); // 2am CST = 8am UTC
  // 1st Sunday of November
  const novFirst = new Date(Date.UTC(year, 10, 1));
  const novFirstSun = new Date(Date.UTC(year, 10, 1 + (7 - novFirst.getUTCDay()) % 7, 7)); // 2am CDT = 7am UTC
  if (timestampMs >= marchSecondSun.getTime() && timestampMs < novFirstSun.getTime()) {
    return -5 * 60 * 60 * 1000; // CDT
  }
  return -6 * 60 * 60 * 1000; // CST
}

/**
 * Get the production date string (yyyy-mm-dd) for a timestamp.
 * Uses 6am boundary: pulls before 6am belong to the previous day's production.
 */
function getProductionDate(timestampMs) {
  // Convert to CST/CDT to match device-side 6am production day boundary
  const cstOffset = getCSTOffset(timestampMs);
  const localMs = timestampMs + cstOffset;
  const d = new Date(localMs);
  if (d.getUTCHours() < 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Calculate window-averaged bbls/day.
 * Replicates the history screen formula (firebase.ts:712-800):
 * - For each consecutive pull pair, calculate flowRateDays = timeDifDays / recoveryFeet
 * - Group by 6am-6am window, average all flowRateDays in the current window
 * - bbls/day = round((1 / avgFlowRateDays) * bblPerFoot)
 *
 * @param {Array} historicalPulls - sorted ascending by timestamp from getHistoricalPulls()
 * @param {number} bblPerFoot - barrels per foot (numTanks * 20)
 * @param {number} pullTimestamp - timestamp of the current pull (ms)
 * @returns {number} bbls/day or 0 if insufficient data
 */
function calculateWindowBblsPerDay(historicalPulls, bblPerFoot, pullTimestamp) {
  if (!historicalPulls || historicalPulls.length < 2) {
    console.log(`[WinCalc] Not enough pulls: ${historicalPulls ? historicalPulls.length : 0}`);
    return 0;
  }

  const currentWindowEnd = getWindowEnd(pullTimestamp);
  console.log(`[WinCalc] pullTimestamp=${new Date(pullTimestamp).toISOString()} windowEnd=${new Date(currentWindowEnd).toISOString()}`);

  // Calculate per-pull flow rates and group by window
  const windowFlowRates = new Map();

  for (let i = 1; i < historicalPulls.length; i++) {
    const current = historicalPulls[i];
    const previous = historicalPulls[i - 1];

    // Skip down wells
    if (current.wellDown || previous.wellDown) continue;

    const timeDifDays = (current.timestamp - previous.timestamp) / (1000 * 60 * 60 * 24);
    if (timeDifDays <= 0) continue;

    // Recovery = current top level - previous bottom level
    const prevBottomFeet = Math.max(previous.tankLevelFeet - (previous.bblsTaken / bblPerFoot), 0);
    const recoveryFeet = current.tankLevelFeet - prevBottomFeet;

    if (recoveryFeet <= 0) continue;

    const flowRateDays = timeDifDays / recoveryFeet;
    if (flowRateDays <= 0 || flowRateDays >= 365) continue;

    const windowEnd = getWindowEnd(current.timestamp);
    const existing = windowFlowRates.get(windowEnd) || [];
    existing.push(flowRateDays);
    windowFlowRates.set(windowEnd, existing);
  }

  // Get flow rates for the current window
  let flowRates = windowFlowRates.get(currentWindowEnd);
  let usedPrevWindow = false;

  // If current window has no data, try the previous window
  if (!flowRates || flowRates.length === 0) {
    const prevWindowEnd = currentWindowEnd - 24 * 60 * 60 * 1000;
    flowRates = windowFlowRates.get(prevWindowEnd);
    usedPrevWindow = true;
  }

  if (!flowRates || flowRates.length === 0) {
    console.log(`[WinCalc] No flow rates in current or previous window. Windows available: ${Array.from(windowFlowRates.keys()).map(k => new Date(k).toISOString()).join(', ')}`);
    return 0;
  }

  const avgFlowRateDays = flowRates.reduce((a, b) => a + b, 0) / flowRates.length;
  if (avgFlowRateDays <= 0) return 0;

  const feetPer24hrs = 1 / avgFlowRateDays;
  const result = Math.round(feetPer24hrs * bblPerFoot);
  console.log(`[WinCalc] ${usedPrevWindow ? 'PREV' : 'CURR'} window: ${flowRates.length} rates, avg=${avgFlowRateDays.toFixed(4)} days/ft → ${result} bbls/day`);
  return result;
}

/**
 * Calculate overnight/longest-gap bbls/day.
 * Finds the longest time gap between consecutive pulls in the current 6am window,
 * then calculates bbls/day from that single gap (most accurate — no human error).
 *
 * @param {Array} historicalPulls - sorted ascending by timestamp from getHistoricalPulls()
 * @param {number} bblPerFoot - barrels per foot (numTanks * 20)
 * @param {number} pullTimestamp - timestamp of the current pull (ms)
 * @returns {number} bbls/day or 0 if insufficient data
 */
function calculateOvernightBblsPerDay(historicalPulls, bblPerFoot, pullTimestamp) {
  if (!historicalPulls || historicalPulls.length < 2) {
    console.log(`[ONCalc] Not enough pulls: ${historicalPulls ? historicalPulls.length : 0}`);
    return 0;
  }

  // Driver's manual method: most recent pull from any previous day → first pull today.
  const todayDate = new Date(pullTimestamp).toISOString().slice(0, 10);

  let firstPullToday = null;
  let lastPullPrevDay = null;

  // Pulls are chronological (oldest first). Walk backwards.
  for (let i = historicalPulls.length - 1; i >= 0; i--) {
    const pull = historicalPulls[i];
    const pullDate = new Date(pull.timestamp).toISOString().slice(0, 10);

    if (pullDate === todayDate) {
      firstPullToday = pull; // Keeps overwriting — last one standing is earliest today
    } else {
      lastPullPrevDay = pull; // Most recent pull from a previous day
      break;
    }
  }

  if (!firstPullToday || !lastPullPrevDay) {
    console.log(`[ONCalc] No previous day pull found`);
    return 0;
  }
  if (firstPullToday.wellDown || lastPullPrevDay.wellDown) return 0;

  const timeDifDays = (firstPullToday.timestamp - lastPullPrevDay.timestamp) / (1000 * 60 * 60 * 24);
  if (timeDifDays <= 0) return 0;

  const prevBottomFeet = Math.max(lastPullPrevDay.tankLevelFeet - (lastPullPrevDay.bblsTaken / bblPerFoot), 0);
  const recoveryFeet = firstPullToday.tankLevelFeet - prevBottomFeet;
  if (recoveryFeet <= 0) return 0;

  const flowRateDays = timeDifDays / recoveryFeet;
  const result = Math.round((1 / flowRateDays) * bblPerFoot);
  console.log(`[ONCalc] prevDay=${new Date(lastPullPrevDay.timestamp).toISOString()} today=${new Date(firstPullToday.timestamp).toISOString()} gap=${timeDifDays.toFixed(4)}d recov=${recoveryFeet.toFixed(2)}ft → ${result} bbls/day`);
  return result;
}

/**
 * Write daily production log to Firebase.
 * Stores AFR, window-averaged, and overnight bbls/day for comparison.
 * Path: production/{wellKey}/{yyyy-mm-dd}
 * Fields: a=AFR, w=window, o=overnight, u=updatedAt, n=pullCount
 */
async function writeProductionLog(wellName, pullTimestamp, afrBblsDay, windowBblsDay, overnightBblsDay) {
  try {
    const wellKey = wellName.replace(/\s+/g, "_");
    const prodDate = getProductionDate(pullTimestamp);

    const ref = db.ref(`production/${wellKey}/${prodDate}`);
    const current = (await ref.once("value")).val();
    const pullCount = (current?.n || 0) + 1;

    await ref.set({
      a: afrBblsDay || 0,
      w: windowBblsDay || 0,
      o: overnightBblsDay || 0,
      u: new Date().toISOString(),
      n: pullCount,
    });

    // Store wellName at the well level for display
    await db.ref(`production/${wellKey}/wellName`).set(wellName);

    console.log(`[Production] ${wellName} ${prodDate}: afr=${afrBblsDay} window=${windowBblsDay} overnight=${overnightBblsDay} pulls=${pullCount}`);
  } catch (error) {
    console.error(`[Production] Error writing log for ${wellName}:`, error);
  }
}

/**
 * Calculate full tank response from a pull packet
 * Uses AFR algorithm for accurate predictions
 * Wrapper that fetches data internally - use calculateResponseWithData for pre-fetched data
 */
async function calculateResponse(packet, wellConfig) {
  const wellName = packet.wellName;
  const bblPerFoot = wellConfig.bblPerFoot;

  // Get historical data for AFR + bbls/day calculation (limit=500 for window calc)
  const historicalPulls = await getHistoricalPulls(wellName, 500);
  const flowData = calculateFlowRates(historicalPulls, bblPerFoot);

  return calculateResponseWithData(packet, wellConfig, historicalPulls, flowData);
}

/**
 * Calculate full tank response from a pull packet with pre-fetched data
 * Uses AFR algorithm for accurate predictions
 */
async function calculateResponseWithData(packet, wellConfig, historicalPulls, flowData) {
  const wellName = packet.wellName;
  const topLevel = parseFloat(packet.tankLevelFeet) || 0;
  const bblsTaken = parseFloat(packet.bblsTaken) || 0;
  const wellDown = packet.wellDown === true || packet.wellDown === "true";
  const bblPerFoot = wellConfig.bblPerFoot;
  const numTanks = wellConfig.numTanks;
  const loadLine = wellConfig.loadLine || 0;
  const pullBbls = wellConfig.pullBbls || 140;

  // Calculate bottom level after pull
  const feetTaken = bblsTaken / bblPerFoot;
  const bottomLevel = Math.max(0, topLevel - feetTaken);

  // Get Adaptive Flow Rate from pre-calculated flow data
  let afrDays = getAdaptiveFlowRate(flowData, wellName);

  // If no AFR available, try to get from last response
  if (!afrDays || afrDays <= 0) {
    const lastResponse = await getLastResponseForWell(wellName);
    if (lastResponse && lastResponse.flowRate && lastResponse.flowRate !== "N/A") {
      // Parse H:MM:SS format
      const timeMatch = lastResponse.flowRate.match(/^(\d+):(\d{2}):(\d{2})$/);
      if (timeMatch) {
        const hours = parseInt(timeMatch[1], 10);
        const minutes = parseInt(timeMatch[2], 10);
        const seconds = parseInt(timeMatch[3], 10);
        afrDays = (hours + minutes / 60 + seconds / 3600) / 24;
      }
    }
  }

  // Ultimate fallback: use wellConfig's avgFlowRate if available
  // This handles new wells with no history or corrupted data
  if (!afrDays || afrDays <= 0) {
    if (wellConfig.avgFlowRateMinutes && wellConfig.avgFlowRateMinutes > 0) {
      // avgFlowRateMinutes is minutes per inch, convert to days per foot
      // days = (minutes per inch * 12 inches) / (60 * 24 minutes per day)
      afrDays = (wellConfig.avgFlowRateMinutes * 12) / (60 * 24);
      console.log(`Using wellConfig.avgFlowRateMinutes (${wellConfig.avgFlowRateMinutes}) as fallback for ${wellName}`);
    }
  }

  // Format timestamps - both local and UTC
  const now = new Date();
  const driverTimezone = packet.timezone || "America/Chicago";

  // Pull time - when the pull actually happened (for level calculations)
  // This is critical: currentLevel represents the level AT PULL TIME, so
  // timestampUTC must also be pull time for accurate live level calculations
  let pullTime = now;
  if (packet.dateTimeUTC) {
    const parsed = new Date(packet.dateTimeUTC);
    if (!isNaN(parsed.getTime())) {
      pullTime = parsed;
    }
  }

  // Local timestamp (in driver's timezone) - for display (uses pull time)
  const timestamp = pullTime.toLocaleString("en-US", {
    timeZone: driverTimezone,
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });

  // UTC timestamp - for calculations (ISO 8601 format) - uses pull time
  const timestampUTC = pullTime.toISOString();

  // Calculate window-averaged and overnight bbls/day
  // Use the historicalPulls already passed in (callers fetch with limit=500)
  console.log(`[BblsDay] ${wellName}: ${historicalPulls.length} historical pulls for window/overnight calc`);
  const windowBblsDay = calculateWindowBblsPerDay(historicalPulls, bblPerFoot, pullTime.getTime());
  const overnightBblsDay = calculateOvernightBblsPerDay(historicalPulls, bblPerFoot, pullTime.getTime());
  console.log(`[BblsDay] ${wellName}: windowBblsDay=${windowBblsDay} overnightBblsDay=${overnightBblsDay} bblPerFoot=${bblPerFoot}`);

  // Calculate predictions
  let flowRate = "N/A";
  let bbls24hrs = "N/A";
  let timeTillPull = "N/A";
  let nextPullTime = "N/A";
  let nextPullTimeUTC = "";

  if (afrDays && afrDays > 0 && !wellDown) {
    // Format flow rate as H:MM:SS
    flowRate = formatFlowRate(afrDays);

    // BBLs per 24 hours = (1 / daysPerFoot) * bblPerFoot
    const feetPer24hrs = 1 / afrDays;
    bbls24hrs = Math.round(feetPer24hrs * bblPerFoot).toString();

    // Calculate target height for next pull
    // Target = (pullBbls / numTanks / 20) + loadLine (in feet)
    const bblsPerTank = pullBbls / numTanks;
    const targetFeet = (bblsPerTank / 20) + loadLine;

    // Recovery needed = target - bottom level
    const recoveryNeeded = Math.max(0, targetFeet - bottomLevel);

    if (recoveryNeeded > 0) {
      // Time to fill from pull time = recovery * afrDays
      const daysToFillFromPull = recoveryNeeded * afrDays;

      // Next pull time = pull time + time to fill
      const nextPullDate = new Date(pullTime.getTime() + daysToFillFromPull * 24 * 60 * 60 * 1000);
      nextPullTime = nextPullDate.toLocaleString("en-US", {
        timeZone: driverTimezone,
        month: "numeric",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
      });
      nextPullTimeUTC = nextPullDate.toISOString();

      // Time till pull from NOW (for display) = time remaining from submission
      const daysFromNow = (nextPullDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
      timeTillPull = formatTimeTillPull(Math.max(0, daysFromNow));
    } else {
      // Already ready
      timeTillPull = "0:00";
      nextPullTime = timestamp;
      nextPullTimeUTC = timestampUTC;
    }
  }

  // Handle well down status
  if (wellDown) {
    timeTillPull = "Down";
    nextPullTime = "No ETA available";
    nextPullTimeUTC = "";
  }

  // Last pull info from the current packet
  const lastPullDateTime = packet.dateTime || timestamp;
  const lastPullDateTimeUTC = packet.dateTimeUTC || timestampUTC;

  return {
    wellName: wellName,
    currentLevel: formatLevel(bottomLevel),
    timeTillPull: timeTillPull,
    nextPullTime: nextPullTime,
    nextPullTimeUTC: nextPullTimeUTC,
    flowRate: flowRate,
    bbls24hrs: bbls24hrs,
    status: "success",
    timestamp: timestamp,
    timestampUTC: timestampUTC,
    lastPullDateTime: lastPullDateTime,
    lastPullDateTimeUTC: lastPullDateTimeUTC,
    lastPullBbls: bblsTaken.toString(),
    lastPullTopLevel: formatLevel(topLevel),
    lastPullBottomLevel: formatLevel(bottomLevel),
    wellDown: wellDown,
    processedBy: "CloudFunction",
    isEdit: packet.isEdit || false,  // Pass through edit flag for UI refresh
    originalPacketId: packet.originalPacketId || null,  // Track what was edited
    windowBblsDay: windowBblsDay > 0 ? windowBblsDay.toString() : null,
    overnightBblsDay: overnightBblsDay > 0 ? overnightBblsDay.toString() : null,
  };
}

/**
 * Get the last response for a well from packets/outgoing
 */
async function getLastResponseForWell(wellName) {
  try {
    const snapshot = await db.ref("packets/outgoing")
      .orderByChild("wellName")
      .equalTo(wellName)
      .limitToLast(5)
      .once("value");

    const responses = snapshot.val();
    if (!responses) return null;

    // Find the most recent response
    let latestResponse = null;
    let latestTime = 0;

    for (const [key, resp] of Object.entries(responses)) {
      if (!resp.timestamp) continue;
      const respTime = new Date(resp.timestampUTC || resp.timestamp).getTime();
      if (respTime > latestTime) {
        latestTime = respTime;
        latestResponse = resp;
      }
    }

    return latestResponse;
  } catch (error) {
    console.error("Error fetching last response:", error);
    return null;
  }
}

/**
 * Increment the incoming_version counter to notify app
 * App watches this to know when new responses are ready in outgoing/
 */
async function incrementIncomingVersion() {
  try {
    const snapshot = await db.ref("packets/incoming_version").once("value");
    // Parse as integer to prevent string concatenation (e.g., "85" + 1 = "851")
    const currentVersion = parseInt(snapshot.val(), 10) || 0;
    await db.ref("packets/incoming_version").set(currentVersion + 1);
    console.log(`Incremented incoming_version to ${currentVersion + 1}`);
  } catch (error) {
    console.error("Error incrementing incoming_version:", error);
  }
}

/**
 * Increment the processed_version counter to notify VBA/Excel
 * VBA polls this to know when new packets are in processed/ for Excel update
 */
async function incrementProcessedVersion() {
  try {
    const snapshot = await db.ref("packets/processed_version").once("value");
    const currentVersion = parseInt(snapshot.val(), 10) || 0;
    await db.ref("packets/processed_version").set(currentVersion + 1);
    console.log(`Incremented processed_version to ${currentVersion + 1}`);
  } catch (error) {
    console.error("Error incrementing processed_version:", error);
  }
}

/**
 * Process packet: copy to processed, notify watchers
 * Cloud Functions calculate response and write to outgoing/
 * VBA reads from incoming/, processes, and deletes when done
 * Tags packet with vbaWasDown: true if VBA heartbeat is stale
 *
 * @param packetId - The packet ID
 * @param packet - The original packet data
 * @param enrichment - Extra fields to add to processed packet (raw flow rate data, etc.)
 */
async function copyToProcessedAndNotifyVBA(packetId, packet, enrichment = {}) {
  try {
    // Check if VBA is online
    const vbaOnline = await isVbaOnline();

    // Build enriched packet with all extra fields
    const enrichedPacket = {
      ...packet,
      ...enrichment,
      processedAt: new Date().toISOString()
    };

    if (!vbaOnline) {
      enrichedPacket.vbaWasDown = true;
      console.log(`Tagging packet ${packetId} with vbaWasDown=true`);
    }

    // Write to processed
    await db.ref(`packets/processed/${packetId}`).set(enrichedPacket);

    // Always delete from incoming after processing
    // Cloud Function handles everything now - no longer waiting for Excel/VBA
    await db.ref(`packets/incoming/${packetId}`).remove();
    console.log(`Packet processed: ${packetId} - deleted from incoming`);

    // Increment incoming_version so VBA knows to check incoming/
    // App also watches this to fetch updated responses from outgoing/
    await incrementIncomingVersion();
  } catch (error) {
    console.error(`Error processing packet: ${packetId}`, error);
  }
}

/**
 * Firebase Function: Process incoming pull packets - PRIMARY handler
 * Triggers when any data is written to packets/incoming/{packetId}
 * Always processes immediately - no longer waits for Excel
 */
exports.processPacket = functions.database
  .ref("/packets/incoming/{packetId}")
  .onCreate(async (snapshot, context) => {
    const startTime = Date.now();
    const packetId = context.params.packetId;
    const packet = snapshot.val();

    console.log(`🚀 [${new Date().toISOString()}] Processing packet: ${packetId}`);
    console.log(`⏱️ Function triggered - packet was written to Firebase, now processing...`);

    // Skip non-pull packet types (handled by other functions) — but NOT edits
    if (packet.requestType === "wellHistory" ||
        packet.requestType === "performanceReport") {
      console.log(`Skipping packet type: ${packet.requestType} - handled by other function`);
      return null;
    }

    const isEdit = packet.requestType === "edit";

    const wellName = packet.wellName;
    if (!wellName) {
      console.error("No well name in packet");
      return null;
    }

    // Get well config from Firebase
    const wellConfig = await getWellConfigFromFirebase(wellName);
    if (!wellConfig) {
      console.error(`Unknown well: ${wellName}`);
      // Create error response
      const wellNameClean = wellName.replace(/\s+/g, "");
      const packetParts = packetId.split("_");
      const timestamp = packetParts.length >= 2 ? `${packetParts[0]}_${packetParts[1]}` : packetId;
      const errorResponseId = `response_${timestamp}_${wellNameClean}`;
      const errorResponse = {
        wellName: wellName,
        status: "error",
        errorMessage: `Unknown well: ${wellName}. Please add to well_config.`,
        timestamp: new Date().toISOString()
      };
      await db.ref(`packets/outgoing/${errorResponseId}`).set(errorResponse);
      // Still move to processed so it doesn't get re-processed
      await copyToProcessedAndNotifyVBA(packetId, packet);
      return null;
    }

    // If this is an edit, mark the original packet as wasEdited and tag this packet
    if (isEdit && packet.packetId) {
      try {
        await db.ref(`packets/processed/${packet.packetId}/wasEdited`).set(true);
        await db.ref(`packets/processed/${packet.packetId}/editedByPacketId`).set(packetId);
        console.log(`Marked original as edited: ${packet.packetId}`);
      } catch (err) {
        console.error(`Error marking original packet:`, err);
      }
      // Set isEdit + originalPacketId on the edit packet so well-data screen shows "Edited" badge
      packet.isEdit = true;
      packet.originalPacketId = packet.packetId;
    }

    // Get historical data for AFR + bbls/day calculation (limit=500 for window calc)
    const historicalPulls = await getHistoricalPulls(wellName, 500);
    const flowData = calculateFlowRates(historicalPulls, wellConfig.bblPerFoot);

    // Get the PREVIOUS response BEFORE we delete it - need it for performance data
    // This is what the driver was looking at when they pulled
    const prevResponse = await getLastResponseForWell(wellName);

    // Calculate full response with AFR
    const response = await calculateResponseWithData(packet, wellConfig, historicalPulls, flowData);

    // Build response ID: response_<timestamp>_<wellNameClean>
    // Strip "edit_" prefix for edits so response key matches normal format
    const wellNameClean = wellName.replace(/\s+/g, "");
    const cleanId = packetId.replace(/^edit_/, "");
    const packetParts = cleanId.split("_");
    const timestamp = packetParts.length >= 2 ? `${packetParts[0]}_${packetParts[1]}` : cleanId;
    const responseId = `response_${timestamp}_${wellNameClean}`;

    // Delete any old responses for this well before writing new one
    try {
      const outgoingSnapshot = await db.ref("packets/outgoing").once("value");
      const outgoing = outgoingSnapshot.val();
      if (outgoing) {
        const deletePromises = [];
        for (const key of Object.keys(outgoing)) {
          // Delete old responses for this well (except the new one)
          if (key.startsWith("response_") &&
              key.toLowerCase().includes(wellNameClean.toLowerCase()) &&
              key !== responseId) {
            console.log(`Deleting old response: ${key}`);
            deletePromises.push(db.ref(`packets/outgoing/${key}`).remove());
          }
        }
        await Promise.all(deletePromises);
      }
    } catch (cleanupError) {
      console.error("Error cleaning up old responses:", cleanupError);
    }

    // Write the new response
    await db.ref(`packets/outgoing/${responseId}`).set(response);
    console.log(`Response written: ${responseId}`);

    // Write performance data for this pull (for Performance screen - VBA independent)
    // Uses PREVIOUS response (captured above) to get predicted level (what driver saw on screen)
    await writePerformanceData(packet, wellConfig, prevResponse);

    // Write daily production log (window-averaged vs overnight bbls/day)
    const pullTimeMs = packet.dateTimeUTC ? new Date(packet.dateTimeUTC).getTime() : Date.now();
    const afrVal = response.bbls24hrs && response.bbls24hrs !== "N/A" ? parseInt(response.bbls24hrs) : 0;
    const winVal = response.windowBblsDay ? parseInt(response.windowBblsDay) : 0;
    const onVal = response.overnightBblsDay ? parseInt(response.overnightBblsDay) : 0;
    console.log(`[ProdLog] ${wellName}: bbls24hrs="${response.bbls24hrs}" windowBblsDay="${response.windowBblsDay}" overnightBblsDay="${response.overnightBblsDay}" → afr=${afrVal} win=${winVal} on=${onVal}`);
    await writeProductionLog(wellName, pullTimeMs, afrVal, winVal, onVal);

    // Calculate enrichment data (raw flow rate, etc.) like VBA used to add
    const enrichment = calculatePacketEnrichment(packet, wellConfig, historicalPulls, response);

    // Move packet to processed and notify VBA
    await copyToProcessedAndNotifyVBA(packetId, packet, enrichment);

    const totalTime = Date.now() - startTime;
    console.log(`✅ [${new Date().toISOString()}] DONE processing ${packetId} in ${totalTime}ms`);

    return null;
  });

/**
 * Firebase Function: processEditPacket (DEPRECATED)
 * Edits are now handled directly by processPacket — same flow as a new pull.
 * This function is kept as a no-op so the deployed function doesn't error.
 */
exports.processEditPacket = functions.database
  .ref("/packets/incoming/{packetId}")
  .onCreate(async (snapshot, context) => {
    // Edits are now handled by processPacket — nothing to do here
    return null;
  });

/**
 * Firebase Function: Handle delete packets from Excel
 * When IT deletes a row in Excel, VBA sends a delete packet here
 * We clean up:
 *   1. packets/outgoing/response_{timestamp}_{wellName} - IF it matches this pull
 *   2. packets/processed/{packetId} - the backup
 *   3. performance/{wellName}/rows/{timestamp} - the performance data
 */
exports.processDeletePacket = functions.database
  .ref("/packets/incoming/{deletePacketId}")
  .onCreate(async (snapshot, context) => {
    const deletePacketId = context.params.deletePacketId;
    const packet = snapshot.val();

    // Only handle delete packets
    if (packet.requestType !== "delete") {
      return null;
    }

    console.log(`Processing delete packet: ${deletePacketId}`);

    const wellName = packet.wellName;
    const originalPacketId = packet.packetId;
    const packetTimestamp = packet.packetTimestamp;

    if (!wellName || !originalPacketId) {
      console.error("Missing wellName or packetId in delete packet");
      // Move delete packet to processed anyway
      await db.ref(`packets/processed/${deletePacketId}`).set({
        ...packet,
        processedAt: new Date().toISOString(),
        error: "Missing required fields"
      });
      await db.ref(`packets/incoming/${deletePacketId}`).remove();
      return null;
    }

    const wellNameClean = wellName.replace(/\s+/g, "");
    const wellKey = wellName.replace(/\s+/g, "_");

    let deletedItems = [];
    let errors = [];

    // 1. Delete from packets/processed/{packetId}
    try {
      const processedRef = db.ref(`packets/processed/${originalPacketId}`);
      const processedSnapshot = await processedRef.once("value");
      if (processedSnapshot.exists()) {
        await processedRef.remove();
        console.log(`Deleted from processed: ${originalPacketId}`);
        deletedItems.push(`processed/${originalPacketId}`);
      } else {
        console.log(`Not found in processed: ${originalPacketId}`);
      }
    } catch (err) {
      console.error(`Error deleting from processed: ${err.message}`);
      errors.push(`processed: ${err.message}`);
    }

    // 2. Delete from performance/{wellKey}/rows/{timestamp}
    // Performance rows use the timestamp portion (yyyymmdd_hhnnss)
    if (packetTimestamp) {
      try {
        const perfRef = db.ref(`performance/${wellKey}/rows/${packetTimestamp}`);
        const perfSnapshot = await perfRef.once("value");
        if (perfSnapshot.exists()) {
          await perfRef.remove();
          console.log(`Deleted from performance: ${wellKey}/rows/${packetTimestamp}`);
          deletedItems.push(`performance/${wellKey}/rows/${packetTimestamp}`);
        } else {
          console.log(`Not found in performance: ${wellKey}/rows/${packetTimestamp}`);
        }
      } catch (err) {
        console.error(`Error deleting from performance: ${err.message}`);
        errors.push(`performance: ${err.message}`);
      }
    }

    // 3. Delete the current response for this well (we'll recreate it from the new most-recent pull)
    let deletedResponseKey = null;
    try {
      const outgoingSnapshot = await db.ref("packets/outgoing").once("value");
      const outgoing = outgoingSnapshot.val();
      if (outgoing) {
        for (const key of Object.keys(outgoing)) {
          // Response key format: response_{timestamp}_{wellNameClean}
          if (key.startsWith("response_") && key.endsWith(`_${wellNameClean}`)) {
            deletedResponseKey = key;
            await db.ref(`packets/outgoing/${key}`).remove();
            console.log(`Deleted response from outgoing: ${key}`);
            deletedItems.push(`outgoing/${key}`);
            break; // Only one response per well
          }
        }
      }
    } catch (err) {
      console.error(`Error deleting outgoing response: ${err.message}`);
      errors.push(`outgoing: ${err.message}`);
    }

    // 4. Find the now-most-recent pull and create a new response
    // This ensures the app and Excel get updated with the correct current state
    let newResponseCreated = false;
    try {
      const mostRecentPacket = await getMostRecentPullPacket(wellName);

      if (mostRecentPacket) {
        console.log(`Found new most-recent pull for ${wellName}: ${mostRecentPacket.dateTimeUTC || mostRecentPacket.dateTime}`);

        // Get well config
        const wellConfig = await getWellConfigFromFirebase(wellName);
        if (wellConfig) {
          // Calculate new response
          const response = await calculateResponse(mostRecentPacket, wellConfig);

          // Build response ID from the most recent packet's timestamp
          let responseTimestamp;
          if (mostRecentPacket.dateTimeUTC) {
            const d = new Date(mostRecentPacket.dateTimeUTC);
            responseTimestamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
          } else if (mostRecentPacket.dateTime) {
            const d = new Date(mostRecentPacket.dateTime);
            responseTimestamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
          } else {
            // Fallback - shouldn't happen
            responseTimestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
          }

          const newResponseId = `response_${responseTimestamp}_${wellNameClean}`;
          await db.ref(`packets/outgoing/${newResponseId}`).set(response);
          console.log(`Created new response: ${newResponseId} for well ${wellName}`);
          newResponseCreated = true;
        } else {
          console.error(`No well config found for ${wellName}, cannot create new response`);
          errors.push(`No well config for ${wellName}`);
        }
      } else {
        console.log(`No remaining pulls for ${wellName} - no new response created`);
        // This is fine - well now has no data
      }
    } catch (err) {
      console.error(`Error creating new response after delete: ${err.message}`);
      errors.push(`new response: ${err.message}`);
    }

    // 5. Move delete packet to processed (for audit trail)
    try {
      await db.ref(`packets/processed/${deletePacketId}`).set({
        ...packet,
        processedAt: new Date().toISOString(),
        deletedItems: deletedItems,
        newResponseCreated: newResponseCreated,
        errors: errors.length > 0 ? errors : null
      });
      await db.ref(`packets/incoming/${deletePacketId}`).remove();
      console.log(`Delete packet processed: ${deletePacketId}, deleted ${deletedItems.length} items, new response: ${newResponseCreated}`);
    } catch (err) {
      console.error(`Error moving delete packet to processed: ${err.message}`);
    }

    return null;
  });

/**
 * Firebase Function: Handle wellHistory requests
 * These still need VBA since they read from the Excel database
 * We just move them to processed so VBA can see them
 */
exports.processWellHistoryRequest = functions.database
  .ref("/packets/incoming/{packetId}")
  .onCreate(async (snapshot, context) => {
    const packetId = context.params.packetId;
    const packet = snapshot.val();

    // Only handle wellHistory requests
    if (packet.requestType !== "wellHistory") {
      return null;
    }

    console.log(`WellHistory request received: ${packetId}`);

    // These still need VBA - it has the full historical data in Excel
    // Don't move to processed - leave in incoming for VBA to handle
    // VBA will move it when done

    return null;
  });

/**
 * Firebase Function: Handle performanceReport requests
 * These still need VBA since they rebuild from Excel data
 */
exports.processPerformanceRequest = functions.database
  .ref("/packets/incoming/{packetId}")
  .onCreate(async (snapshot, context) => {
    const packetId = context.params.packetId;
    const packet = snapshot.val();

    // Only handle performanceReport requests
    if (packet.requestType !== "performanceReport") {
      return null;
    }

    console.log(`Performance report request received: ${packetId}`);

    // These still need VBA - it rebuilds from Excel sheet data
    // Don't move to processed - leave in incoming for VBA to handle

    return null;
  });
