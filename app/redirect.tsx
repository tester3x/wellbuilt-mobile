// app/redirect.tsx
// Handles OAuth redirect - processes auth code if present (fixes Android cold start)
import * as AuthSession from "expo-auth-session";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import { useRouter, useRootNavigationState } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

const CLIENT_ID = "f9f2f468-76f3-4fc2-8d2e-70c8d28d8292";
const TENANT = "consumers";

const discovery = {
  authorizationEndpoint: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`,
  tokenEndpoint: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
};

const redirectUri = AuthSession.makeRedirectUri({
  scheme: "wellbuiltmobile",
  path: "redirect",
});

export default function RedirectScreen() {
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const [status, setStatus] = useState<string>("Processing...");

  useEffect(() => {
    // Wait until navigation is ready
    if (!rootNavigationState?.key) return;

    const handleRedirect = async () => {
      try {
        // Check if we have an auth code in the URL (cold start case)
        const initialUrl = await Linking.getInitialURL();
        console.log("[Redirect] Initial URL:", initialUrl);

        if (initialUrl && initialUrl.includes("code=")) {
          setStatus("Completing sign in...");
          
          const url = new URL(initialUrl);
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");

          if (error) {
            console.log("[Redirect] Auth error:", error);
            setStatus("Sign in failed");
            setTimeout(() => router.replace("/welcome"), 1500);
            return;
          }

          if (code) {
            console.log("[Redirect] Got auth code, exchanging for token...");
            
            // Get saved code verifier (if we have one)
            const codeVerifier = await SecureStore.getItemAsync("pendingCodeVerifier");
            
            if (!codeVerifier) {
              console.log("[Redirect] No code verifier found - app was killed during auth");
              // Can't complete the exchange without the verifier
              // User will need to try again
              setStatus("Session expired, please try again");
              await SecureStore.deleteItemAsync("pendingCodeVerifier");
              setTimeout(() => router.replace("/welcome"), 1500);
              return;
            }

            try {
              const tokenResponse = await AuthSession.exchangeCodeAsync(
                {
                  clientId: CLIENT_ID,
                  code: code,
                  redirectUri: redirectUri,
                  extraParams: { code_verifier: codeVerifier },
                },
                discovery
              );

              console.log("[Redirect] Token exchange successful");

              await SecureStore.setItemAsync("accessToken", tokenResponse.accessToken);
              if (tokenResponse.refreshToken) {
                await SecureStore.setItemAsync("refreshToken", tokenResponse.refreshToken);
              }

              const expiresAt = Date.now() + (tokenResponse.expiresIn ?? 3600) * 1000;
              await SecureStore.setItemAsync("tokenExpiresAt", expiresAt.toString());
              
              // Clean up
              await SecureStore.deleteItemAsync("pendingCodeVerifier");

              setStatus("Success!");
              // Go to main app
              setTimeout(() => router.replace("/(tabs)"), 500);
              return;
            } catch (tokenError) {
              console.error("[Redirect] Token exchange failed:", tokenError);
              setStatus("Sign in failed");
              await SecureStore.deleteItemAsync("pendingCodeVerifier");
              setTimeout(() => router.replace("/welcome"), 1500);
              return;
            }
          }
        }

        // No auth code - just a normal redirect, go to root
        router.replace("/");
      } catch (err) {
        console.error("[Redirect] Error:", err);
        router.replace("/");
      }
    };

    handleRedirect();
  }, [rootNavigationState?.key, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color="#60A5FA" />
      <Text style={styles.status}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#05060B",
    alignItems: "center",
    justifyContent: "center",
  },
  status: {
    marginTop: 16,
    color: "#9CA3AF",
    fontSize: 14,
  },
});
