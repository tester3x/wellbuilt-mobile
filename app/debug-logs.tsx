// app/debug-logs.tsx
// Debug log viewer screen

import { useRouter } from "expo-router";
import React, { useState, useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Share,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getLogs, clearLogs, getLogsAsText, flushLogsToFirebase } from "../src/services/debugLog";

export default function DebugLogsScreen() {
  const router = useRouter();
  const [logs, setLogs] = useState<ReturnType<typeof getLogs>>([]);
  const [isSending, setIsSending] = useState(false);

  const loadLogs = useCallback(() => {
    setLogs(getLogs());
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadLogs();
      // Refresh every 2 seconds while on screen
      const interval = setInterval(loadLogs, 2000);
      return () => clearInterval(interval);
    }, [loadLogs])
  );

  const handleShare = async () => {
    try {
      const text = getLogsAsText();
      if (!text) {
        Alert.alert("No Logs", "No logs to share yet.");
        return;
      }
      await Share.share({
        message: `WellBuilt Debug Logs:\n\n${text}`,
        title: "WellBuilt Debug Logs",
      });
    } catch (error) {
      console.error("Share error:", error);
    }
  };

  const handleClear = () => {
    Alert.alert(
      "Clear Logs",
      "Are you sure you want to clear all debug logs?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            clearLogs();
            loadLogs();
          },
        },
      ]
    );
  };

  const handleSendToFirebase = async () => {
    setIsSending(true);
    try {
      const success = await flushLogsToFirebase();
      if (success) {
        Alert.alert("Sent", "Logs sent to Firebase.");
      } else {
        Alert.alert("Nothing to Send", "No warnings or errors to send.");
      }
    } catch (error) {
      Alert.alert("Error", "Failed to send logs.");
    }
    setIsSending(false);
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error': return '#EF4444';
      case 'warn': return '#F59E0B';
      default: return '#9CA3AF';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{"<"}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Debug Logs</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={handleSendToFirebase} style={styles.actionButton} disabled={isSending}>
            <Text style={[styles.actionText, styles.sendText]}>{isSending ? 'Sending...' : 'Send'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleShare} style={styles.actionButton}>
            <Text style={styles.actionText}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleClear} style={styles.actionButton}>
            <Text style={[styles.actionText, styles.clearText]}>Clear</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Log count */}
      <Text style={styles.logCount}>{logs.length} logs (auto-refreshing)</Text>

      {/* Logs */}
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {logs.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No logs yet</Text>
            <Text style={styles.emptySubtext}>
              Recovery events and errors will appear here automatically.
              {'\n'}Logs auto-send to Firebase when app goes to background.
            </Text>
          </View>
        ) : (
          logs.map((log, index) => (
            <View key={index} style={styles.logEntry}>
              <View style={styles.logHeader}>
                <Text style={[styles.logLevel, { color: getLevelColor(log.level) }]}>
                  {log.level.toUpperCase()}
                </Text>
                <Text style={styles.logTime}>
                  {log.timestamp.toLocaleTimeString()}
                </Text>
              </View>
              <Text style={styles.logMessage} selectable>
                {log.message}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
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
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1F2937",
  },
  backButton: {
    padding: 8,
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
  },
  headerActions: {
    flexDirection: "row",
    gap: 12,
  },
  actionButton: {
    padding: 8,
  },
  actionText: {
    color: "#60A5FA",
    fontSize: 14,
    fontWeight: "500",
  },
  sendText: {
    color: "#34D399",
  },
  clearText: {
    color: "#EF4444",
  },
  logCount: {
    color: "#6B7280",
    fontSize: 12,
    textAlign: "center",
    paddingVertical: 8,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 12,
    gap: 8,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyText: {
    color: "#9CA3AF",
    fontSize: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    color: "#6B7280",
    fontSize: 14,
    textAlign: "center",
  },
  logEntry: {
    backgroundColor: "#1F2937",
    borderRadius: 8,
    padding: 12,
  },
  logHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  logLevel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  logTime: {
    color: "#6B7280",
    fontSize: 10,
  },
  logMessage: {
    color: "#E5E7EB",
    fontSize: 12,
    fontFamily: "monospace",
    lineHeight: 18,
  },
});
