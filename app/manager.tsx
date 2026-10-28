// Legacy RTDB manager actions are retired. Keep the existing unavailable
// route for saved links; administration uses the authenticated Dashboard.
import React from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function ManagerScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{"<"}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('manager.title')}</Text>
        <View style={styles.headerActions} />
      </View>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 28 }}>
        <Text style={{ color: '#F9FAFB', fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 12 }}>
          {t('common.updateRequired')}
        </Text>
        <Text style={{ color: '#9CA3AF', fontSize: 15, textAlign: 'center', lineHeight: 22 }}>
          {t('common.updateRequiredBody')}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111827",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1F2937",
  },
  backButton: {
    padding: 8,
    flex: 1,
  },
  backText: {
    color: "#60A5FA",
    fontSize: 24,
    fontWeight: "bold",
  },
  headerTitle: {
    color: "#F9FAFB",
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  headerActions: {
    flexDirection: "row",
    gap: 12,
    flex: 1,
    justifyContent: "flex-end",
  },
});
