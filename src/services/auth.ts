// src/services/auth.ts
// Client Credentials flow for Microsoft Graph API
// App authenticates directly - no user sign-in required
// Accesses the wellbuiltllc OneDrive for all operations

import * as SecureStore from "expo-secure-store";
import { ONEDRIVE_CREDENTIALS } from "../config/credentials";

const { clientId, clientSecret, tenantId, tokenEndpoint, scope, driveOwnerEmail } =
  ONEDRIVE_CREDENTIALS;

// Cache token in memory for performance
let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

// Get access token using client credentials flow
export const getAccessToken = async (): Promise<string | null> => {
  // Check memory cache first
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  // Check SecureStore
  const storedToken = await SecureStore.getItemAsync("accessToken");
  const storedExpiry = await SecureStore.getItemAsync("tokenExpiresAt");

  if (storedToken && storedExpiry) {
    const expiryTime = parseInt(storedExpiry, 10);
    if (Date.now() < expiryTime - 60000) {
      cachedToken = storedToken;
      tokenExpiresAt = expiryTime;
      return storedToken;
    }
  }

  // Need to get a new token
  return await fetchNewToken();
};

// Fetch new token from Microsoft
const fetchNewToken = async (): Promise<string | null> => {
  console.log("[Auth] Fetching new token via client credentials...");

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: scope,
      grant_type: "client_credentials",
    });

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Auth] Token request failed:", response.status, errorText);
      return null;
    }

    const data = await response.json();
    const accessToken = data.access_token;
    const expiresIn = data.expires_in || 3600;
    const expiresAt = Date.now() + expiresIn * 1000;

    // Cache in memory
    cachedToken = accessToken;
    tokenExpiresAt = expiresAt;

    // Store in SecureStore
    await SecureStore.setItemAsync("accessToken", accessToken);
    await SecureStore.setItemAsync("tokenExpiresAt", expiresAt.toString());

    console.log("[Auth] Token obtained successfully, expires in", expiresIn, "seconds");
    return accessToken;
  } catch (error) {
    console.error("[Auth] Error fetching token:", error);
    return null;
  }
};

// Get existing token without fetching new one (for background operations)
export const getExistingToken = async (): Promise<string | null> => {
  // Check memory cache
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  // Check SecureStore
  const storedToken = await SecureStore.getItemAsync("accessToken");
  const storedExpiry = await SecureStore.getItemAsync("tokenExpiresAt");

  if (storedToken && storedExpiry) {
    const expiryTime = parseInt(storedExpiry, 10);
    if (Date.now() < expiryTime - 60000) {
      cachedToken = storedToken;
      tokenExpiresAt = expiryTime;
      return storedToken;
    }
  }

  // Token expired or doesn't exist - try to refresh
  return await fetchNewToken();
};

// Ensure we have a valid token (will fetch if needed)
export const ensureAccessToken = async (): Promise<string> => {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Failed to obtain access token");
  }
  return token;
};

// Sign in is now automatic with client credentials
// This function exists for compatibility with existing code
export const signIn = async (): Promise<string | null> => {
  console.log("[Auth] signIn called - using client credentials (automatic)");
  return await getAccessToken();
};

// Force new token
export const forceSignIn = async (): Promise<string | null> => {
  console.log("[Auth] Force sign-in - clearing cached token");
  cachedToken = null;
  tokenExpiresAt = 0;
  await SecureStore.deleteItemAsync("accessToken");
  await SecureStore.deleteItemAsync("tokenExpiresAt");
  return await fetchNewToken();
};

// Sign out clears cached tokens
export const signOut = async () => {
  console.log("[Auth] Signing out - clearing all tokens");
  cachedToken = null;
  tokenExpiresAt = 0;
  await SecureStore.deleteItemAsync("accessToken");
  await SecureStore.deleteItemAsync("tokenExpiresAt");
  await SecureStore.deleteItemAsync("userEmail");
  await SecureStore.deleteItemAsync("userName");
};

// Check if we can get a token (always true with client credentials if configured correctly)
export const isSignedIn = async (): Promise<boolean> => {
  const token = await getAccessToken();
  return token !== null;
};

// Get "current user" - in client credentials mode, this is the app itself
// Returns the drive owner email for compatibility
export const getCurrentUser = async (): Promise<{ email: string; name: string } | null> => {
  return {
    email: driveOwnerEmail,
    name: "WellBuilt App",
  };
};

// Get the drive owner's user ID (needed for accessing their OneDrive)
// This is called once and cached
let driveOwnerUserId: string | null = null;
let driveId: string | null = null;

export const getDriveOwnerUserId = async (): Promise<string | null> => {
  if (driveOwnerUserId) {
    return driveOwnerUserId;
  }

  const token = await getAccessToken();
  if (!token) return null;

  try {
    // First, try to list users in the tenant
    console.log("[Auth] Looking for users in tenant...");
    const usersResponse = await fetch(
      `https://graph.microsoft.com/v1.0/users`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (usersResponse.ok) {
      const usersData = await usersResponse.json();
      console.log("[Auth] Users found:", usersData.value?.length || 0);

      // Find the wellbuiltllc user or the first user with a license
      const users = usersData.value || [];
      for (const user of users) {
        console.log("[Auth] User:", user.userPrincipalName, user.id);
        // Use the first user that has a OneDrive
        if (user.id) {
          driveOwnerUserId = user.id;
          console.log("[Auth] Using user ID:", driveOwnerUserId);
          return driveOwnerUserId;
        }
      }
    } else {
      console.log("[Auth] Could not list users:", usersResponse.status);
    }

    // Fallback: Try to get the root site's drive
    console.log("[Auth] Trying root site drive...");
    const siteResponse = await fetch(
      `https://graph.microsoft.com/v1.0/sites/root`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (siteResponse.ok) {
      const siteData = await siteResponse.json();
      console.log("[Auth] Root site ID:", siteData.id);
      // We'll use the site-based approach instead
      return "USE_SITE";
    }

    return null;
  } catch (error) {
    console.error("[Auth] Error getting drive owner user ID:", error);
    return null;
  }
};

// Get the drive ID for the WellBuilt drive
export const getDriveId = async (): Promise<string | null> => {
  if (driveId) {
    return driveId;
  }

  const token = await getAccessToken();
  if (!token) return null;

  try {
    // Try to get the user's drive
    const userId = await getDriveOwnerUserId();

    if (userId && userId !== "USE_SITE") {
      const driveResponse = await fetch(
        `https://graph.microsoft.com/v1.0/users/${userId}/drive`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (driveResponse.ok) {
        const driveData = await driveResponse.json();
        driveId = driveData.id;
        console.log("[Auth] Drive ID:", driveId);
        return driveId;
      } else {
        console.log("[Auth] Could not get user drive:", driveResponse.status);
      }
    }

    // Fallback: Try root site's default drive
    const siteResponse = await fetch(
      `https://graph.microsoft.com/v1.0/sites/root/drive`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (siteResponse.ok) {
      const siteData = await siteResponse.json();
      driveId = siteData.id;
      console.log("[Auth] Site drive ID:", driveId);
      return driveId;
    }

    return null;
  } catch (error) {
    console.error("[Auth] Error getting drive ID:", error);
    return null;
  }
};

// Get the base URL for accessing the WellBuilt OneDrive
export const getDriveBaseUrl = async (): Promise<string | null> => {
  const id = await getDriveId();
  if (!id) return null;
  return `https://graph.microsoft.com/v1.0/drives/${id}`;
};
