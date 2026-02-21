// Quick script to register an admin driver directly in Firebase
// Run with: node scripts/register-admin.js
//
// This bypasses the approval flow - use for initial admin setup only
//
// NEW STRUCTURE (device-bound):
//   drivers/approved/{passcodeHash}/{deviceId}/ = { displayName, approvedAt, active, isAdmin }
//
// The "admin-device" deviceId is a special placeholder that allows passcode-only login
// from any device (for the admin account only). Regular drivers must register each device.

const crypto = require('crypto');

const FIREBASE_DATABASE_URL = "https://wellbuilt-sync-default-rtdb.firebaseio.com";
const FIREBASE_API_KEY = "AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI";

// ===== CONFIGURE THESE =====
const ADMIN_DISPLAY_NAME = "Admin";  // Change to your name
const ADMIN_PASSCODE = "iH8pa$$words";   // Change to your passcode!
const ADMIN_DEVICE_ID = "admin-device";  // Special placeholder for admin
// ===========================

async function registerAdmin() {
  // Hash the passcode using SHA-256
  const hash = crypto.createHash('sha256').update(ADMIN_PASSCODE).digest('hex').toLowerCase();

  const driverData = {
    displayName: ADMIN_DISPLAY_NAME,
    approvedAt: new Date().toISOString(),
    active: true,
    isAdmin: true,
  };

  console.log("Registering admin driver (new structure)...");
  console.log("  Display Name:", ADMIN_DISPLAY_NAME);
  console.log("  Passcode:", ADMIN_PASSCODE);
  console.log("  Hash:", hash.slice(0, 16) + "...");
  console.log("  Path: drivers/approved/{hash}/" + ADMIN_DEVICE_ID);

  // NEW: Write to drivers/approved/{hash}/{deviceId}/
  const url = `${FIREBASE_DATABASE_URL}/drivers/approved/${hash}/${ADMIN_DEVICE_ID}.json?auth=${FIREBASE_API_KEY}`;

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(driverData),
    });

    if (response.ok) {
      console.log("\nSuccess! Admin driver registered.");
      console.log("You can now log in with passcode:", ADMIN_PASSCODE);
      console.log("\nNote: Admin uses 'admin-device' placeholder, so passcode-only login");
      console.log("works from any device. Regular drivers must register each device.");
    } else {
      const text = await response.text();
      console.error("\nFailed:", response.status, text);
    }
  } catch (error) {
    console.error("\nError:", error.message);
  }
}

registerAdmin();
