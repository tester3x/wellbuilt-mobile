// Clear all driver data from Firebase for fresh start
// Run with: node scripts/clear-drivers.js

const FIREBASE_DATABASE_URL = "https://wellbuilt-sync-default-rtdb.firebaseio.com";
const FIREBASE_API_KEY = "AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI";

async function clearDrivers() {
  console.log("Clearing all driver data from Firebase...\n");

  // Clear approved drivers
  const approvedUrl = `${FIREBASE_DATABASE_URL}/drivers/approved.json?auth=${FIREBASE_API_KEY}`;
  const pendingUrl = `${FIREBASE_DATABASE_URL}/drivers/pending.json?auth=${FIREBASE_API_KEY}`;

  try {
    // Delete approved drivers
    console.log("Deleting drivers/approved...");
    const approvedRes = await fetch(approvedUrl, { method: 'DELETE' });
    if (approvedRes.ok) {
      console.log("  Done.");
    } else {
      console.log("  Failed:", approvedRes.status);
    }

    // Delete pending drivers
    console.log("Deleting drivers/pending...");
    const pendingRes = await fetch(pendingUrl, { method: 'DELETE' });
    if (pendingRes.ok) {
      console.log("  Done.");
    } else {
      console.log("  Failed:", pendingRes.status);
    }

    console.log("\nFirebase driver data cleared!");
    console.log("\nNext steps:");
    console.log("1. Edit scripts/register-admin.js - set YOUR passcode");
    console.log("2. Run: node scripts/register-admin.js");
    console.log("3. Open the app and login with your passcode");

  } catch (error) {
    console.error("Error:", error.message);
  }
}

clearDrivers();
