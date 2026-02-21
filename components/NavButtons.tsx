// components/NavButtons.tsx
// Navigation icons - no background, industry standard placement
// Back = top-left, Home = top-right

import { useRouter } from "expo-router";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { hp, wp } from "../src/ui/layout";

interface NavButtonsProps {
  showBack?: boolean;
  showHome?: boolean;
}

export default function NavButtons({ 
  showBack = true, 
  showHome = true,
}: NavButtonsProps) {
  const router = useRouter();

  const goHome = () => {
    router.replace("/");
  };

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  };

  return (
    <>
      {/* Back button - top left */}
      {showBack && (
        <TouchableOpacity style={styles.backButton} onPress={goBack}>
          <Text style={styles.icon}>◀️</Text>
        </TouchableOpacity>
      )}

      {/* Home button - top right */}
      {showHome && (
        <TouchableOpacity style={styles.homeButton} onPress={goHome}>
          <Text style={styles.icon}>🏠</Text>
        </TouchableOpacity>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  backButton: {
    position: "absolute",
    left: wp("4%"),
    top: hp("2%"),
    zIndex: 100,
    padding: hp("0.5%"),
  },
  homeButton: {
    position: "absolute",
    right: wp("4%"),
    top: hp("2%"),
    zIndex: 100,
    padding: hp("0.5%"),
  },
  icon: {
    fontSize: hp("2.2%"),
  },
});
