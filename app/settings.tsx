import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import DraggableFlatList, { RenderItemParams } from "react-native-draggable-flatlist";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Picker } from "@react-native-picker/picker";
import { useAppAlert } from "../components/AppAlert";
import { loadWellConfig, WellConfigMap } from "../src/services/wellConfig";
import { getLevelSnapshot, loadLevelSnapshots } from "../src/services/wellHistory";
import {
  DispatchRecipient,
  DispatchChannel,
  MessageTemplate,
  MessageFieldPosition,
  loadRecipients,
  saveRecipients,
  addRecipient,
  deleteRecipient,
  updateRecipient,
  loadMessageTemplate,
  saveMessageTemplate,
  isCompactModeEnabled,
  setCompactModeEnabled,
  generateMessage,
  PullMessageData,
} from "../src/services/dispatchMessage";
import {
  clearPullHistory,
  getHistoryDays,
  loadHistoryDaysSetting,
  setHistoryDays,
} from "../src/services/pullHistory";
import {
  getDriverSession,
  isCurrentUserAdmin,
  isCurrentUserViewer,
} from "../src/services/driverAuth";
// Lazy import to avoid expo-notifications warning in Expo Go
// Type import is fine - just avoid runtime import at module level
type WellAlertSettings = {
  enabled: boolean;
  defaultThreshold: number;
  perWellThresholds: { [wellName: string]: number };
  perWellEnabled: { [wellName: string]: boolean };
};

// Lazy loaders for wellAlerts functions
const getAlertFunctions = async () => {
  try {
    const module = await import("../src/services/wellAlerts");
    return {
      getAllAlertSettings: module.getAllAlertSettings,
      setAlertsEnabled: module.setAlertsEnabled,
      setDefaultThreshold: module.setDefaultThreshold,
    };
  } catch (e) {
    console.log("[Settings] Well alerts not available");
    return null;
  }
};
import { hp, spacing, wp } from "../src/ui/layout";

// Storage key for selected wells
const STORAGE_KEY_SELECTED_WELLS = "wellbuilt_selected_wells";
const STORAGE_KEY_SETTINGS_EXPANDED = "wellbuilt_settings_expanded";
const STORAGE_KEY_DISPATCH_ENABLED = "wellbuilt_dispatch_enabled";
const STORAGE_KEY_ROUTE_ORDER = "wellbuilt_route_order";

// Sample data for message preview
const SAMPLE_PULL_DATA: PullMessageData = {
  wellName: "Gabriel 7",
  topLevel: 10.25, // 10'3"
  bottomLevel: 4.5, // 4'6"
  time: new Date(2025, 0, 15, 14, 30), // 2:30pm
  bbls: 115,
};

// Well config interface - imported from wellConfig.ts

interface RouteGroup {
  routeName: string;
  color: string;
  wells: string[];
  expanded: boolean;
}

// Generate unique color from route name using HSL color space
// Uses djb2 hash to pick a hue, then converts to RGB
// Matches VBA implementation in modRecolorRoutes.bas
function getRouteColor(routeName: string): string {
  // djb2 hash - good distribution
  let hash = 5381;
  for (let i = 0; i < routeName.length; i++) {
    hash = ((hash << 5) + hash) + routeName.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  hash = Math.abs(hash);

  // Use hash to pick Hue (0-360), keep Saturation and Lightness fixed
  const hue = hash % 360;
  const sat = 0.65;  // 65% saturation - vibrant but not neon
  const lum = 0.55;  // 55% lightness - visible on dark background

  // Convert HSL to RGB
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = lum - c / 2;

  let r1 = 0, g1 = 0, b1 = 0;
  const hueSection = Math.floor(hue / 60);
  switch (hueSection) {
    case 0: r1 = c; g1 = x; b1 = 0; break;
    case 1: r1 = x; g1 = c; b1 = 0; break;
    case 2: r1 = 0; g1 = c; b1 = x; break;
    case 3: r1 = 0; g1 = x; b1 = c; break;
    case 4: r1 = x; g1 = 0; b1 = c; break;
    default: r1 = c; g1 = 0; b1 = x; break;
  }

  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);

  return `rgb(${r}, ${g}, ${b})`;
}

// Fetch well_config from Firebase (via wellConfig service)
async function fetchWellConfig(): Promise<WellConfigMap | null> {
  try {
    const config = await loadWellConfig(true); // force refresh
    return config;
  } catch (error) {
    console.error("[Settings] Error fetching well config:", error);
    return null;
  }
}

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const alert = useAppAlert();
  const insets = useSafeAreaInsets();

  const [isDispatchMode, setIsDispatchMode] = useState(false);

  // Pull History settings
  const [historyRetentionDays, setHistoryRetentionDays] = useState(7);
  const RETENTION_OPTIONS = [7, 14, 21, 30];

  // Route state
  const [routeGroups, setRouteGroups] = useState<RouteGroup[]>([]);
  const [selectedWells, setSelectedWells] = useState<Set<string>>(new Set());
  const [downWells, setDownWells] = useState<Set<string>>(new Set());
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(true);

  // Dispatch message state
  const [dispatchEnabled, setDispatchEnabled] = useState(false);
  const [dispatchCompactMode, setDispatchCompactMode] = useState(false);
  const [dispatchRecipients, setDispatchRecipients] = useState<DispatchRecipient[]>([]);
  const [messageTemplate, setMessageTemplate] = useState<MessageTemplate | null>(null);
  const [showRecipientModal, setShowRecipientModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingRecipient, setEditingRecipient] = useState<DispatchRecipient | null>(null);
  const [recipientForm, setRecipientForm] = useState({
    name: '',
    phone: '',
    channel: 'sms' as DispatchChannel,
    useCustomTemplate: false,
    customTemplateText: '',
  });
  const [templateText, setTemplateText] = useState('');
  const [templateFields, setTemplateFields] = useState<MessageFieldPosition[]>([]);

  // Well alert settings state
  const [alertSettings, setAlertSettings] = useState<WellAlertSettings | null>(null);

  // Admin/Viewer status from session
  const [isAdmin, setIsAdmin] = useState(false);
  const [isViewer, setIsViewer] = useState(false);

  // Route edit mode for reordering
  const [isRouteEditMode, setIsRouteEditMode] = useState(false);

  // Feet/inches picker modal state
  const [showFeetInchesModal, setShowFeetInchesModal] = useState(false);
  const [tempFeet, setTempFeet] = useState(12);
  const [tempInches, setTempInches] = useState(0);
  const feetListRef = useRef<FlatList>(null);
  const inchesListRef = useRef<FlatList>(null);

  // Data arrays for pickers
  const feetData = Array.from({ length: 20 }, (_, i) => i + 1); // 1-20
  const inchesData = Array.from({ length: 12 }, (_, i) => i); // 0-11
  const ITEM_HEIGHT = 50;

  // Load settings on mount
  useEffect(() => {
    loadRoutesAndSelections();
    loadHistorySettings();
    loadDispatchSettings();
    loadAlertSettingsData();
    loadAdminStatus();
  }, []);

  // Check if user is admin or viewer
  const loadAdminStatus = async () => {
    const session = await getDriverSession();
    if (session) {
      setIsAdmin(session.isAdmin || false);
      setIsViewer(session.isViewer || false);
    }
  };

  // Load alert settings (lazy to avoid expo-notifications in Expo Go)
  const loadAlertSettingsData = async () => {
    const fns = await getAlertFunctions();
    if (fns) {
      const settings = await fns.getAllAlertSettings();
      setAlertSettings(settings);
    }
  };

  // Toggle alerts enabled
  const handleAlertsEnabledToggle = async (value: boolean) => {
    if (!alertSettings) return;
    const fns = await getAlertFunctions();
    if (fns) {
      await fns.setAlertsEnabled(value);
      setAlertSettings({ ...alertSettings, enabled: value });
    }
  };

  // Update default threshold
  const handleDefaultThresholdChange = async (newThreshold: number) => {
    if (!alertSettings) return;
    const fns = await getAlertFunctions();
    if (fns) {
      await fns.setDefaultThreshold(newThreshold);
      setAlertSettings({ ...alertSettings, defaultThreshold: newThreshold });
    }
  };

  const loadHistorySettings = async () => {
    const days = await loadHistoryDaysSetting();
    setHistoryRetentionDays(days);
  };

  const handleRetentionChange = async (days: number) => {
    setHistoryRetentionDays(days);
    await setHistoryDays(days);
  };

  const handleClearHistory = () => {
    alert.show(
      "Clear Pull History",
      "This will delete all pull history entries. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: async () => {
            await clearPullHistory();
            alert.show("Cleared", "Pull history has been cleared.");
          },
        },
      ]
    );
  };

  // Dispatch message functions
  const loadDispatchSettings = async () => {
    // Load enabled state
    const savedEnabled = await AsyncStorage.getItem(STORAGE_KEY_DISPATCH_ENABLED);
    setDispatchEnabled(savedEnabled === 'true');

    // Load compact mode state
    const compactEnabled = await isCompactModeEnabled();
    setDispatchCompactMode(compactEnabled);

    const recipients = await loadRecipients();
    setDispatchRecipients(recipients);

    const template = await loadMessageTemplate();
    setMessageTemplate(template);
    if (template) {
      setTemplateText(template.template);
      setTemplateFields(template.fields);
    }
  };

  const handleDispatchEnabledToggle = async (value: boolean) => {
    setDispatchEnabled(value);
    await AsyncStorage.setItem(STORAGE_KEY_DISPATCH_ENABLED, value ? 'true' : 'false');
  };

  const handleCompactModeToggle = async (value: boolean) => {
    setDispatchCompactMode(value);
    await setCompactModeEnabled(value);
  };

  const handleAddRecipient = () => {
    setEditingRecipient(null);
    setRecipientForm({
      name: '',
      phone: '',
      channel: 'sms',
      useCustomTemplate: false,
      customTemplateText: '',
    });
    setShowRecipientModal(true);
  };

  const handleEditRecipient = (recipient: DispatchRecipient) => {
    setEditingRecipient(recipient);
    setRecipientForm({
      name: recipient.name,
      phone: recipient.phone,
      channel: recipient.channel,
      useCustomTemplate: !!recipient.customTemplate,
      customTemplateText: recipient.customTemplate?.template || '',
    });
    setShowRecipientModal(true);
  };

  const handleSaveRecipient = async () => {
    if (!recipientForm.name.trim() || !recipientForm.phone.trim()) {
      alert.show(t('record.errorGenericTitle'), t('settings.errorRequired'));
      return;
    }

    // Build custom template if enabled and has content
    let customTemplate: MessageTemplate | undefined;
    if (recipientForm.useCustomTemplate && recipientForm.customTemplateText.trim()) {
      const fields = parseTemplatePlaceholders(recipientForm.customTemplateText);
      customTemplate = {
        template: recipientForm.customTemplateText,
        fields,
      };
    }

    if (editingRecipient) {
      await updateRecipient(editingRecipient.id, {
        name: recipientForm.name.trim(),
        phone: recipientForm.phone.trim(),
        channel: recipientForm.channel,
        customTemplate,
      });
    } else {
      await addRecipient({
        name: recipientForm.name.trim(),
        phone: recipientForm.phone.trim(),
        channel: recipientForm.channel,
        enabled: true,
        customTemplate,
      });
    }

    await loadDispatchSettings();
    setShowRecipientModal(false);
  };

  const handleDeleteRecipient = (id: string) => {
    alert.show(
      "Delete Recipient",
      "Are you sure you want to remove this recipient?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteRecipient(id);
            await loadDispatchSettings();
          },
        },
      ]
    );
  };

  const handleToggleRecipient = async (id: string, enabled: boolean) => {
    await updateRecipient(id, { enabled });
    await loadDispatchSettings();
  };

  const handleOpenTemplateEditor = () => {
    if (messageTemplate) {
      setTemplateText(messageTemplate.template);
      setTemplateFields(messageTemplate.fields);
    } else {
      // Default template example
      setTemplateText('');
      setTemplateFields([]);
    }
    setShowTemplateModal(true);
  };

  const handleSaveTemplate = async () => {
    const template: MessageTemplate = {
      template: templateText,
      fields: templateFields,
    };
    await saveMessageTemplate(template);
    setMessageTemplate(template);
    setShowTemplateModal(false);
    alert.show("Saved", "Message template saved successfully");
  };

  // Simple field detection from template text
  const detectFieldAtPosition = (text: string, position: number): { start: number; end: number; word: string } | null => {
    // Find word boundaries around position
    let start = position;
    let end = position;

    // Move start back to word boundary
    while (start > 0 && !/\s/.test(text[start - 1])) {
      start--;
    }

    // Move end forward to word boundary
    while (end < text.length && !/\s/.test(text[end])) {
      end++;
    }

    if (start === end) return null;

    return {
      start,
      end,
      word: text.substring(start, end),
    };
  };

  const handleTemplateFieldSelect = (fieldType: string) => {
    // For simplicity, we'll use placeholder markers that users type
    // They type {well}, {top}, {bottom}, {time}, {time24}, {bbls} in their template
    // This is simpler than tap-to-select UI
    const placeholder = `{${fieldType}}`;
    setTemplateText(prev => prev + placeholder);
  };

  // Parse placeholders from template text
  const parseTemplatePlaceholders = (text: string): MessageFieldPosition[] => {
    const fields: MessageFieldPosition[] = [];
    const regex = /\{(well|top|bottom|time|time24|bbls)\}/gi;
    let match;

    while ((match = regex.exec(text)) !== null) {
      fields.push({
        field: match[1].toLowerCase() as MessageFieldPosition['field'],
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    return fields;
  };

  // Generate preview message from template text
  const getPreviewMessage = (templateText: string): string => {
    if (!templateText.trim()) {
      return t('settings.previewPlaceholder');
    }
    const template: MessageTemplate = {
      template: templateText,
      fields: parseTemplatePlaceholders(templateText),
    };
    return generateMessage(template, SAMPLE_PULL_DATA);
  };

  const loadRoutesAndSelections = async () => {
    setIsLoadingRoutes(true);

    // Load saved selections
    const savedSelections = await AsyncStorage.getItem(STORAGE_KEY_SELECTED_WELLS);
    const initialSelections = savedSelections ? new Set<string>(JSON.parse(savedSelections)) : new Set<string>();

    // Load saved expanded states
    const savedExpanded = await AsyncStorage.getItem(STORAGE_KEY_SETTINGS_EXPANDED);
    const expandedStates: { [routeName: string]: boolean } = savedExpanded ? JSON.parse(savedExpanded) : {};

    // Load saved route order
    const savedOrder = await AsyncStorage.getItem(STORAGE_KEY_ROUTE_ORDER);
    const routeOrder: string[] = savedOrder ? JSON.parse(savedOrder) : [];

    // Load level snapshots for DOWN status
    await loadLevelSnapshots();

    // Fetch well config
    const config = await fetchWellConfig();

    if (config) {
      // Group wells by route and track colors from config
      const routeMap: { [route: string]: { wells: string[], color: string } } = {};

      Object.entries(config).forEach(([wellName, wellConfig]) => {
        const route = wellConfig.route || "Unknown";
        if (!routeMap[route]) {
          // Use routeColor from config if available, fallback to calculated
          routeMap[route] = {
            wells: [],
            color: wellConfig.routeColor || getRouteColor(route)
          };
        }
        routeMap[route].wells.push(wellName);
      });

      // Sort wells within each route
      Object.keys(routeMap).forEach(route => {
        routeMap[route].wells.sort((a, b) => a.localeCompare(b));
      });

      // Create route groups - use saved expanded state, default to collapsed
      const groups: RouteGroup[] = Object.entries(routeMap)
        .map(([routeName, data]) => ({
          routeName,
          color: data.color,
          wells: data.wells,
          expanded: expandedStates[routeName] ?? false,
        }));

      // Sort by saved order - routes not in saved order go to bottom alphabetically
      groups.sort((a, b) => {
        const aIndex = routeOrder.indexOf(a.routeName);
        const bIndex = routeOrder.indexOf(b.routeName);

        // Both in saved order - use saved positions
        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex;
        }
        // Only a is in saved order - a comes first
        if (aIndex !== -1) return -1;
        // Only b is in saved order - b comes first
        if (bIndex !== -1) return 1;
        // Neither in saved order - alphabetical (new routes)
        return a.routeName.localeCompare(b.routeName);
      });

      setRouteGroups(groups);

      // If route order was empty or has new routes, save the current order
      const currentRouteNames = groups.map(g => g.routeName);
      if (routeOrder.length === 0 || currentRouteNames.some(r => !routeOrder.includes(r))) {
        await AsyncStorage.setItem(STORAGE_KEY_ROUTE_ORDER, JSON.stringify(currentRouteNames));
      }

      // Build set of DOWN wells from level snapshots and config
      const downSet = new Set<string>();
      for (const wellName of Object.keys(config)) {
        const snapshot = await getLevelSnapshot(wellName);
        const isDown = snapshot?.isDown ?? config[wellName]?.isDown ?? false;
        if (isDown) {
          downSet.add(wellName);
        }
      }
      setDownWells(downSet);

      // If no saved selections, default to selecting all wells
      if (initialSelections.size === 0) {
        const allWells = new Set<string>(Object.keys(config));
        setSelectedWells(allWells);
        await AsyncStorage.setItem(STORAGE_KEY_SELECTED_WELLS, JSON.stringify([...allWells]));
      } else {
        setSelectedWells(initialSelections);
      }
    }

    setIsLoadingRoutes(false);
  };

  // Handle route reorder via drag
  const handleRouteReorder = async (data: RouteGroup[]) => {
    setRouteGroups(data);
    // Save the new order
    const order = data.map(r => r.routeName);
    console.log('[Settings] Saving route order:', order);
    await AsyncStorage.setItem(STORAGE_KEY_ROUTE_ORDER, JSON.stringify(order));
  };

  // Toggle edit mode for route reordering
  const toggleRouteEditMode = () => {
    setIsRouteEditMode(prev => !prev);
  };

  // Save selections whenever they change
  const saveSelections = async (selections: Set<string>) => {
    await AsyncStorage.setItem(STORAGE_KEY_SELECTED_WELLS, JSON.stringify([...selections]));
  };

  // Toggle individual well
  const toggleWell = (wellName: string) => {
    const newSelections = new Set(selectedWells);
    if (newSelections.has(wellName)) {
      newSelections.delete(wellName);
    } else {
      newSelections.add(wellName);
    }
    setSelectedWells(newSelections);
    saveSelections(newSelections);
  };

  // Toggle all wells in a route
  const toggleRouteAll = (routeName: string) => {
    const route = routeGroups.find(r => r.routeName === routeName);
    if (!route) return;
    
    const allSelected = route.wells.every(w => selectedWells.has(w));
    const newSelections = new Set(selectedWells);
    
    if (allSelected) {
      // Deselect all in route
      route.wells.forEach(w => newSelections.delete(w));
    } else {
      // Select all in route
      route.wells.forEach(w => newSelections.add(w));
    }
    
    setSelectedWells(newSelections);
    saveSelections(newSelections);
  };

  // Toggle route expansion and persist
  const toggleRouteExpanded = async (routeName: string) => {
    const updatedGroups = routeGroups.map(r => 
      r.routeName === routeName ? { ...r, expanded: !r.expanded } : r
    );
    setRouteGroups(updatedGroups);
    
    // Save expanded states
    const expandedStates: { [key: string]: boolean } = {};
    updatedGroups.forEach(r => {
      expandedStates[r.routeName] = r.expanded;
    });
    await AsyncStorage.setItem(STORAGE_KEY_SETTINGS_EXPANDED, JSON.stringify(expandedStates));
  };

  // Check if all wells in route are selected
  const isRouteAllSelected = (route: RouteGroup): boolean => {
    return route.wells.every(w => selectedWells.has(w));
  };

  // Check if some (but not all) wells in route are selected
  const isRoutePartialSelected = (route: RouteGroup): boolean => {
    const selectedCount = route.wells.filter(w => selectedWells.has(w)).length;
    return selectedCount > 0 && selectedCount < route.wells.length;
  };

  const toggleLanguage = () => {
    const next = (i18n.language || 'en').startsWith("es") ? "en" : "es";
    i18n.changeLanguage(next);
  };

  const handleAboutPress = () => {
    router.push('/about');
  };

  // Render checkbox
  const renderCheckbox = (checked: boolean, partial?: boolean) => (
    <View style={[
      styles.checkbox,
      checked && styles.checkboxChecked,
      partial && styles.checkboxPartial,
    ]}>
      {checked && !partial && <Text style={styles.checkmark}>{'✓'}</Text>}
      {partial && <Text style={styles.checkmark}>{'-'}</Text>}
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        scrollEnabled={!isRouteEditMode}
      >
      {/* Simple header */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Text style={styles.backText}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("settings.title")}</Text>
        <TouchableOpacity
          onPress={handleAboutPress}
          style={styles.infoButton}
        >
          <Text style={styles.infoButtonText}>{'?'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.description}>{t("settings.description")}</Text>

      {/* Account card - visible to all drivers (top for quick access) */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("settings.accountTitle")}</Text>
        <Text style={styles.cardSubtitle}>
          {t("settings.accountSubtitle")}
        </Text>

        {/* Button row - evenly spaced */}
        <View style={styles.accountButtonRow}>
          <TouchableOpacity
            style={[styles.accountButton, styles.accountButtonDanger]}
            onPress={() => {
              alert.show(
                t("settings.logOut"),
                t("settings.logOutConfirm"),
                [
                  { text: t("settings.cancel"), style: 'cancel' },
                  {
                    text: t("settings.logOut"),
                    style: 'destructive',
                    onPress: async () => {
                      const { clearDriverSession } = await import('../src/services/driverAuth');
                      await clearDriverSession();
                      router.replace('/driver-login');
                    },
                  },
                ]
              );
            }}
          >
            <Text style={styles.accountButtonDangerText}>{t("settings.logOut")}</Text>
          </TouchableOpacity>
          {/* Manager button for admins - in same row */}
          {isAdmin && (
            <TouchableOpacity
              style={[styles.accountButton, styles.accountButtonAdmin]}
              onPress={() => router.push('/manager' as any)}
            >
              <Text style={styles.accountButtonAdminText}>{t("manager.title")}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Routes card */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>{t("settings.routesTitle")}</Text>
          <View style={styles.routeHeaderButtons}>
            <TouchableOpacity
              style={styles.routeEditButton}
              onPress={toggleRouteEditMode}
            >
              <Text style={[styles.refreshButtonText, isRouteEditMode && styles.editButtonTextActive]}>
                {isRouteEditMode ? t("settings.routesDone") : t("settings.routesEdit")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.refreshButton}
              onPress={loadRoutesAndSelections}
              disabled={isLoadingRoutes}
            >
              <Text style={styles.refreshButtonText}>
                {isLoadingRoutes ? '...' : t("settings.routesRefresh")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.cardSubtitle}>
          {t("settings.routesSubtitle")}
        </Text>

        {isLoadingRoutes ? (
          <Text style={styles.loadingText}>{t("settings.routesLoading")}</Text>
        ) : routeGroups.length === 0 ? (
          <Text style={styles.loadingText}>{t("settings.routesNone")}</Text>
        ) : (
          <GestureHandlerRootView style={styles.routesContainer}>
            <DraggableFlatList
              data={routeGroups}
              keyExtractor={(item) => item.routeName}
              onDragEnd={({ data }) => handleRouteReorder(data)}
              activationDistance={10}
              scrollEnabled={false}
              renderItem={({ item: route, drag, isActive }: RenderItemParams<RouteGroup>) => (
                <View style={[styles.routeSection, isActive && styles.routeSectionDragging]}>
                  {/* Route header */}
                  <TouchableOpacity
                    style={[styles.routeHeader, isActive && styles.routeHeaderDragging]}
                    onPress={() => !isRouteEditMode && toggleRouteExpanded(route.routeName)}
                    onLongPress={isRouteEditMode ? drag : undefined}
                    delayLongPress={150}
                    disabled={isActive}
                  >
                    {isRouteEditMode && (
                      <View style={styles.dragHandle}>
                        <Text style={styles.dragHandleText}>=</Text>
                      </View>
                    )}
                    <View style={[styles.routeColorBar, { backgroundColor: route.color }]} />
                    {!isRouteEditMode && (
                      <Text style={styles.routeExpandIcon}>
                        {route.expanded ? 'v' : '>'}
                      </Text>
                    )}
                    <Text style={[styles.routeName, { color: route.color }]}>{route.routeName}</Text>
                    <Text style={styles.routeCount}>
                      ({route.wells.filter(w => selectedWells.has(w)).length}/{route.wells.length})
                    </Text>
                  </TouchableOpacity>

                  {/* Route wells - only show when not in edit mode */}
                  {route.expanded && !isRouteEditMode && (
                    <View style={styles.routeWells}>
                      {/* Select All row */}
                      <TouchableOpacity
                        style={styles.wellRow}
                        onPress={() => toggleRouteAll(route.routeName)}
                      >
                        {renderCheckbox(
                          isRouteAllSelected(route),
                          isRoutePartialSelected(route)
                        )}
                        <Text style={styles.wellNameAll}>{t("settings.routesSelectAll")}</Text>
                      </TouchableOpacity>

                      {/* Individual wells */}
                      {route.wells.map((wellName) => {
                        const isDown = downWells.has(wellName);
                        return (
                          <TouchableOpacity
                            key={wellName}
                            style={[styles.wellRow, isDown && styles.wellRowDown]}
                            onPress={() => toggleWell(wellName)}
                          >
                            {renderCheckbox(selectedWells.has(wellName))}
                            <Text style={[styles.wellName, isDown && styles.wellNameDown]}>
                              {wellName}
                            </Text>
                            {isDown && (
                              <Text style={styles.downBadge}>{t('settingsExtra.down')}</Text>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}
            />
          </GestureHandlerRootView>
        )}
      </View>

      {/* Well Level Alerts card */}
      {alertSettings && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("settings.alertsTitle")}</Text>
          <Text style={styles.cardSubtitle}>
            {t("settings.alertsSubtitle")}
          </Text>

          {/* Enable/disable toggle */}
          <View style={styles.alertEnableRow}>
            <View style={styles.alertEnableInfo}>
              <Text style={styles.alertEnableLabel}>
                {alertSettings.enabled ? t("settings.alertsEnabled") : t("settings.alertsDisabled")}
              </Text>
              <Text style={styles.alertEnableHint}>
                {alertSettings.enabled
                  ? t("settings.alertsEnabledHint")
                  : t("settings.alertsDisabledHint")}
              </Text>
            </View>
            <Switch
              value={alertSettings.enabled}
              onValueChange={handleAlertsEnabledToggle}
              thumbColor="#F9FAFB"
              trackColor={{ false: "#374151", true: "#2563EB" }}
            />
          </View>

          {/* Threshold setting - only show when enabled */}
          {alertSettings.enabled && (
            <View style={styles.alertThresholdSection}>
              <Text style={styles.alertThresholdLabel}>
                {t("settings.alertThresholdLabel")}
              </Text>

              <TouchableOpacity
                style={styles.alertThresholdDisplay}
                onPress={() => {
                  const feet = Math.floor(alertSettings.defaultThreshold);
                  const inches = Math.round((alertSettings.defaultThreshold % 1) * 12);
                  setTempFeet(feet);
                  setTempInches(inches);
                  setShowFeetInchesModal(true);
                }}
              >
                <Text style={styles.alertThresholdDisplayText}>
                  {Math.floor(alertSettings.defaultThreshold)}' {Math.round((alertSettings.defaultThreshold % 1) * 12)}"
                </Text>
                <Text style={styles.alertThresholdDisplayHint}>{t('settingsExtra.tapToChange')}</Text>
              </TouchableOpacity>

              <Text style={styles.alertNote}>
                {t("settings.alertThresholdNote")}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Pull History card - hide for viewers (they don't have personal pulls) */}
      {!isViewer && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('settings.pullHistoryTitle')}</Text>
          <Text style={styles.cardSubtitle}>
            {t('settings.pullHistorySubtitle')}
          </Text>

          <Text style={styles.retentionLabel}>{t('settings.retentionLabel')}</Text>
          <View style={styles.retentionOptions}>
            {RETENTION_OPTIONS.map((days) => (
              <TouchableOpacity
                key={days}
                style={[
                  styles.retentionButton,
                  historyRetentionDays === days && styles.retentionButtonActive,
                ]}
                onPress={() => handleRetentionChange(days)}
              >
                <Text
                  style={[
                    styles.retentionButtonText,
                    historyRetentionDays === days && styles.retentionButtonTextActive,
                  ]}
                >
                  {t('settings.retentionDays', { days })}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.clearHistoryButton} onPress={handleClearHistory}>
            <Text style={styles.clearHistoryButtonText}>{t('settings.clearHistory')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Dispatch Message card - hide for viewers (they don't pull) */}
      {!isViewer && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('settings.dispatchTitle')}</Text>
          <Text style={styles.cardSubtitle}>
            {t('settings.dispatchSubtitle')}
          </Text>

          {/* Enable/disable toggle */}
          <View style={styles.dispatchEnableRow}>
            <View style={styles.dispatchEnableInfo}>
              <Text style={styles.dispatchEnableLabel}>
                {dispatchEnabled ? t('settings.dispatchEnabled') : t('settings.dispatchDisabled')}
              </Text>
              <Text style={styles.dispatchEnableHint}>
                {dispatchEnabled
                  ? t('settings.dispatchEnabledHint')
                  : t('settings.dispatchDisabledHint')}
              </Text>
            </View>
            <Switch
              value={dispatchEnabled}
              onValueChange={handleDispatchEnabledToggle}
              thumbColor="#F9FAFB"
              trackColor={{ false: "#374151", true: "#2563EB" }}
            />
          </View>

          {/* Compact mode toggle - only show when dispatch is enabled */}
          {dispatchEnabled && (
            <View style={styles.dispatchModeRow}>
              <View style={styles.dispatchEnableInfo}>
                <Text style={styles.dispatchEnableLabel}>
                  {dispatchCompactMode ? t('settings.buttonMode') : t('settings.bannerMode')}
                </Text>
                <Text style={styles.dispatchEnableHint}>
                  {dispatchCompactMode
                    ? t('settings.buttonModeHint')
                    : t('settings.bannerModeHint')}
                </Text>
              </View>
              <Switch
                value={dispatchCompactMode}
                onValueChange={handleCompactModeToggle}
                thumbColor="#F9FAFB"
                trackColor={{ false: "#374151", true: "#2563EB" }}
              />
            </View>
          )}

          {/* Recipients section */}
          <View style={styles.dispatchSection}>
            <View style={styles.dispatchSectionHeader}>
              <Text style={styles.dispatchSectionTitle}>{t('settings.recipients')}</Text>
              <TouchableOpacity style={styles.addButton} onPress={handleAddRecipient}>
                <Text style={styles.addButtonText}>{t('settings.addRecipient')}</Text>
              </TouchableOpacity>
            </View>

            {dispatchRecipients.length === 0 ? (
              <Text style={styles.emptyText}>{t('settings.noRecipients')}</Text>
            ) : (
              dispatchRecipients.map((recipient) => (
                <View key={recipient.id} style={styles.recipientRow}>
                  <Switch
                    value={recipient.enabled}
                    onValueChange={(value) => handleToggleRecipient(recipient.id, value)}
                    thumbColor="#F9FAFB"
                    trackColor={{ false: "#374151", true: "#2563EB" }}
                  />
                  <TouchableOpacity
                    style={styles.recipientInfo}
                    onPress={() => handleEditRecipient(recipient)}
                  >
                    <Text style={styles.recipientName}>
                      {recipient.name}
                      {recipient.customTemplate && <Text style={styles.customBadge}> *</Text>}
                    </Text>
                    <Text style={styles.recipientDetails}>
                      {recipient.phone} ({recipient.channel.toUpperCase()})
                      {recipient.customTemplate && ' - Custom template'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => handleDeleteRecipient(recipient.id)}
                  >
                    <Text style={styles.deleteButtonText}>X</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>

          {/* Message template section */}
          <View style={styles.dispatchSection}>
            <View style={styles.dispatchSectionHeader}>
              <Text style={styles.dispatchSectionTitle}>{t('settings.messageTemplate')}</Text>
              <TouchableOpacity style={styles.editButton} onPress={handleOpenTemplateEditor}>
                <Text style={styles.editButtonText}>{t('settings.editTemplate')}</Text>
              </TouchableOpacity>
            </View>

            {messageTemplate ? (
              <View style={styles.templatePreview}>
                <Text style={styles.templatePreviewText}>{messageTemplate.template}</Text>
              </View>
            ) : (
              <Text style={styles.emptyText}>{t('settings.noTemplate')}</Text>
            )}
          </View>
        </View>
      )}

      {/* Mode card - hide for viewers (related to pulling) */}
      {!isViewer && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("settings.modeTitle")}</Text>
          <Text style={styles.cardSubtitle}>{t("settings.modeSubtitle")}</Text>

          <View style={styles.modeRow}>
            <Text style={styles.modeLabel}>
              {isDispatchMode
                ? t("settings.modeLabelDispatch")
                : t("settings.modeLabelSelf")}
            </Text>
            <Switch
              value={isDispatchMode}
              onValueChange={setIsDispatchMode}
              thumbColor="#F9FAFB"
              trackColor={{ false: "#374151", true: "#2563EB" }}
            />
          </View>
        </View>
      )}

      {/* Language card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("settings.languageTitle")}</Text>
        <Text style={styles.cardSubtitle}>
          {t("settings.languageSubtitle")}
        </Text>

        <TouchableOpacity
          style={styles.languageButton}
          onPress={toggleLanguage}
        >
          <Text style={styles.languageButtonText}>
            {t("common.language")}:{" "}
            {(i18n.language || 'en').startsWith("es")
              ? t("common.spanish")
              : t("common.english")}
          </Text>
        </TouchableOpacity>
      </View>
      </ScrollView>

      {/* Feet/Inches Picker Modal */}
      <Modal
        visible={showFeetInchesModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFeetInchesModal(false)}
      >
        <View style={styles.feetInchesModalOverlay}>
          <View style={styles.feetInchesModalContent}>
            <View style={styles.feetInchesPickerRow}>
              {/* Feet picker */}
              <View style={styles.feetInchesWheelColumn}>
                <Text style={styles.feetInchesPickerLabel}>{t('settingsExtra.feet')}</Text>
                <View style={styles.feetInchesWheelContainer}>
                  <View style={styles.feetInchesWheelHighlight} pointerEvents="none" />
                  <FlatList
                    ref={feetListRef}
                    data={feetData}
                    keyExtractor={(item) => `ft-${item}`}
                    style={styles.feetInchesWheelList}
                    contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
                    showsVerticalScrollIndicator={false}
                    snapToInterval={ITEM_HEIGHT}
                    decelerationRate="fast"
                    scrollEventThrottle={16}
                    onScroll={(e) => {
                      const index = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
                      const clampedIndex = Math.max(0, Math.min(index, feetData.length - 1));
                      setTempFeet(feetData[clampedIndex]);
                    }}
                    initialScrollIndex={tempFeet - 1}
                    getItemLayout={(_, index) => ({
                      length: ITEM_HEIGHT,
                      offset: ITEM_HEIGHT * index,
                      index,
                    })}
                    renderItem={({ item, index }) => (
                      <Pressable
                        style={styles.feetInchesWheelRow}
                        onPress={() => {
                          feetListRef.current?.scrollToIndex({ index, animated: true });
                        }}
                      >
                        <Text style={[
                          styles.feetInchesWheelText,
                          item === tempFeet && styles.feetInchesWheelTextSelected,
                        ]}>
                          {item}
                        </Text>
                      </Pressable>
                    )}
                  />
                </View>
              </View>
              {/* Inches picker */}
              <View style={styles.feetInchesWheelColumn}>
                <Text style={styles.feetInchesPickerLabel}>{t('settingsExtra.inches')}</Text>
                <View style={styles.feetInchesWheelContainer}>
                  <View style={styles.feetInchesWheelHighlight} pointerEvents="none" />
                  <FlatList
                    ref={inchesListRef}
                    data={inchesData}
                    keyExtractor={(item) => `in-${item}`}
                    style={styles.feetInchesWheelList}
                    contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
                    showsVerticalScrollIndicator={false}
                    snapToInterval={ITEM_HEIGHT}
                    decelerationRate="fast"
                    scrollEventThrottle={16}
                    onScroll={(e) => {
                      const index = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
                      const clampedIndex = Math.max(0, Math.min(index, inchesData.length - 1));
                      setTempInches(inchesData[clampedIndex]);
                    }}
                    initialScrollIndex={tempInches}
                    getItemLayout={(_, index) => ({
                      length: ITEM_HEIGHT,
                      offset: ITEM_HEIGHT * index,
                      index,
                    })}
                    renderItem={({ item, index }) => (
                      <Pressable
                        style={styles.feetInchesWheelRow}
                        onPress={() => {
                          inchesListRef.current?.scrollToIndex({ index, animated: true });
                        }}
                      >
                        <Text style={[
                          styles.feetInchesWheelText,
                          item === tempInches && styles.feetInchesWheelTextSelected,
                        ]}>
                          {item}
                        </Text>
                      </Pressable>
                    )}
                  />
                </View>
              </View>
            </View>
            <View style={styles.feetInchesModalButtons}>
              <TouchableOpacity
                style={styles.feetInchesModalCancel}
                onPress={() => setShowFeetInchesModal(false)}
              >
                <Text style={styles.feetInchesModalCancelText}>{t('settingsExtra.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.feetInchesModalConfirm}
                onPress={() => {
                  handleDefaultThresholdChange(tempFeet + tempInches / 12);
                  setShowFeetInchesModal(false);
                }}
              >
                <Text style={styles.feetInchesModalConfirmText}>{t('settingsExtra.set')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Recipient Modal */}
      <Modal
        visible={showRecipientModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRecipientModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.recipientModalContent}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
            <Text style={styles.modalTitle}>
              {editingRecipient ? t('settings.editRecipient') : t('settings.addRecipientTitle')}
            </Text>

            {/* Channel selection - bigger buttons */}
            <View style={styles.sectionBox}>
              <Text style={styles.sectionLabel}>{t('settings.sendVia')}</Text>
              <View style={styles.channelButtonsLarge}>
                <TouchableOpacity
                  style={[styles.channelButtonLarge, recipientForm.channel === 'sms' && styles.channelButtonLargeActive]}
                  onPress={() => setRecipientForm(prev => ({ ...prev, channel: 'sms' }))}
                >
                  <Text style={[styles.channelButtonLargeText, recipientForm.channel === 'sms' && styles.channelButtonLargeTextActive]}>
                    SMS
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.channelButtonLarge, recipientForm.channel === 'whatsapp' && styles.channelButtonLargeActive]}
                  onPress={() => setRecipientForm(prev => ({ ...prev, channel: 'whatsapp' }))}
                >
                  <Text style={[styles.channelButtonLargeText, recipientForm.channel === 'whatsapp' && styles.channelButtonLargeTextActive]}>
                    WhatsApp
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Name and Phone in section box */}
            <View style={styles.sectionBox}>
              <Text style={styles.sectionLabel}>{t('settings.recipientInfo')}</Text>
              <Text style={styles.fieldLabel}>{t('settings.name')}</Text>
              <TextInput
                style={styles.fieldInput}
                value={recipientForm.name}
                onChangeText={(text) => setRecipientForm(prev => ({ ...prev, name: text }))}
                placeholder="e.g., Dispatch, Office"
                placeholderTextColor="#6B7280"
              />
              <Text style={[styles.fieldLabel, { marginTop: spacing.sm }]}>
                {recipientForm.channel === 'whatsapp' ? 'Phone or Group Name' : 'Phone Number'}
              </Text>
              <TextInput
                style={styles.fieldInput}
                value={recipientForm.phone}
                onChangeText={(text) => setRecipientForm(prev => ({ ...prev, phone: text }))}
                placeholder={recipientForm.channel === 'whatsapp' ? "555-123-4567 or Group Name" : "555-123-4567"}
                placeholderTextColor="#6B7280"
                keyboardType={recipientForm.channel === 'whatsapp' ? 'default' : 'phone-pad'}
              />
            </View>

            {/* Custom template section */}
            <View style={styles.sectionBox}>
              <View style={styles.sectionHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionLabel}>{t('settings.customTemplate')}</Text>
                  <Text style={styles.sectionHint}>
                    {recipientForm.useCustomTemplate
                      ? t('settings.customTemplateHintOn')
                      : t('settings.customTemplateHintOff')}
                  </Text>
                </View>
                <Switch
                  value={recipientForm.useCustomTemplate}
                  onValueChange={(value) => setRecipientForm(prev => ({ ...prev, useCustomTemplate: value }))}
                  thumbColor="#F9FAFB"
                  trackColor={{ false: "#374151", true: "#2563EB" }}
                />
              </View>

              {/* Custom template editor (shown when enabled) */}
              {recipientForm.useCustomTemplate && (
                <View style={styles.templateEditorSection}>
                  <Text style={styles.fieldLabel}>{t('settings.messageTemplate')}</Text>
                  <TextInput
                    style={styles.templateTextArea}
                    value={recipientForm.customTemplateText}
                    onChangeText={(text) => setRecipientForm(prev => ({ ...prev, customTemplateText: text }))}
                    placeholder={t('settings.typeMessagePlaceholder')}
                    placeholderTextColor="#6B7280"
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                    autoCorrect={false}
                    autoCapitalize="none"
                    spellCheck={false}
                  />

                  {/* Field insert buttons */}
                  <Text style={styles.fieldLabel}>{t('settings.tapToInsert')}</Text>
                  <View style={styles.insertFieldRow}>
                    {(['well', 'top', 'bottom', 'time', 'time24', 'bbls'] as const).map((field) => (
                      <TouchableOpacity
                        key={field}
                        style={styles.insertFieldButton}
                        onPress={() => setRecipientForm(prev => ({
                          ...prev,
                          customTemplateText: prev.customTemplateText + `{${field}}`,
                        }))}
                      >
                        <Text style={styles.insertFieldButtonText}>{`{${field}}`}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Live preview */}
                  <Text style={styles.previewLabel}>{t('settings.preview')}</Text>
                  <View style={styles.previewBox}>
                    <Text style={styles.previewText}>
                      {getPreviewMessage(recipientForm.customTemplateText)}
                    </Text>
                  </View>
                </View>
              )}
            </View>

            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowRecipientModal(false)}
              >
                <Text style={styles.modalCancelBtnText}>{t('settings.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSaveRecipient}
              >
                <Text style={styles.modalSaveBtnText}>{t('settings.save')}</Text>
              </TouchableOpacity>
            </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Template Modal */}
      <Modal
        visible={showTemplateModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTemplateModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.recipientModalContent}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
            <Text style={styles.modalTitle}>{t('settings.defaultTemplate')}</Text>
            <Text style={styles.modalSubtitle}>
              {t('settings.tapToInsert')}
            </Text>

            <View style={styles.sectionBox}>
              <Text style={styles.sectionLabel}>{t('settings.messageTemplate')}</Text>
              <TextInput
                style={styles.templateTextArea}
                value={templateText}
                onChangeText={setTemplateText}
                placeholder={t('settings.typeMessagePlaceholder')}
                placeholderTextColor="#6B7280"
                multiline
                numberOfLines={5}
                textAlignVertical="top"
                autoCorrect={false}
                autoCapitalize="none"
                spellCheck={false}
              />

              <Text style={styles.fieldLabel}>{t('settings.tapToInsert')}</Text>
              <View style={styles.insertFieldRow}>
                {(['well', 'top', 'bottom', 'time', 'time24', 'bbls'] as const).map((field) => (
                  <TouchableOpacity
                    key={field}
                    style={styles.insertFieldButton}
                    onPress={() => handleTemplateFieldSelect(field)}
                  >
                    <Text style={styles.insertFieldButtonText}>{`{${field}}`}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldHintBox}>
                {'{well}'} = Well name{'\n'}
                {'{top}'} = Level before pull (e.g., 10'3"){'\n'}
                {'{bottom}'} = Level after pull{'\n'}
                {'{time}'} = 12hr format (e.g., 2:30pm){'\n'}
                {'{time24}'} = 24hr format (e.g., 14:30){'\n'}
                {'{bbls}'} = Barrels pulled (e.g., 115 bbls)
              </Text>
            </View>

            {/* Live preview */}
            <View style={styles.sectionBox}>
              <Text style={styles.sectionLabel}>{t('settings.preview')}</Text>
              <Text style={styles.sectionHint}>{t('settings.previewHint')}</Text>
              <View style={styles.previewBox}>
                <Text style={styles.previewText}>
                  {getPreviewMessage(templateText)}
                </Text>
              </View>
            </View>

            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowTemplateModal(false)}
              >
                <Text style={styles.modalCancelBtnText}>{t('settings.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={() => {
                  const fields = parseTemplatePlaceholders(templateText);
                  setTemplateFields(fields);
                  handleSaveTemplate();
                }}
              >
                <Text style={styles.modalSaveBtnText}>{t('settings.save')}</Text>
              </TouchableOpacity>
            </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>


      {/* Styled Alert Modal */}
      <alert.AlertComponent />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#05060B",
    // paddingTop is applied dynamically via insets.top
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: wp("5%"),
    paddingBottom: hp("5%"),
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  backButton: {
    paddingRight: spacing.sm,
    paddingVertical: spacing.xs,
  },
  backText: {
    fontSize: hp("2.4%"),
    color: "#9CA3AF",
  },
  headerTitle: {
    fontSize: hp("2.6%"),
    color: "#F9FAFB",
    fontWeight: "700",
    flex: 1,
  },
  infoButton: {
    padding: spacing.xs,
  },
  infoButtonText: {
    fontSize: hp("2.4%"),
    color: "#60A5FA",
  },
  description: {
    fontSize: hp("1.8%"),
    color: "#9CA3AF",
    marginBottom: spacing.lg,
  },
  card: {
    backgroundColor: "#111827",
    borderRadius: hp("1.5%"),
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  cardTitle: {
    fontSize: hp("2%"),
    color: "#F9FAFB",
    fontWeight: "600",
    marginBottom: spacing.xs,
  },
  cardSubtitle: {
    fontSize: hp("1.6%"),
    color: "#9CA3AF",
    marginBottom: spacing.sm,
  },
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.sm,
  },
  routeHeaderButtons: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  refreshButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    borderRadius: hp("0.8%"),
    backgroundColor: "#1F2937",
    borderWidth: 1,
    borderColor: "#374151",
  },
  routeEditButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    borderRadius: hp("0.8%"),
    backgroundColor: "#1F2937",
    borderWidth: 1,
    borderColor: "#374151",
  },
  refreshButtonText: {
    fontSize: hp("1.4%"),
    color: "#60A5FA",
    fontWeight: "500",
  },
  languageButton: {
    marginTop: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: hp("1%"),
    backgroundColor: "#2563EB",
    alignSelf: "flex-start",
  },
  languageButtonText: {
    fontSize: hp("1.8%"),
    color: "#F9FAFB",
    fontWeight: "500",
  },
  modeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  modeLabel: {
    fontSize: hp("1.8%"),
    color: "#E5E7EB",
    flex: 1,
    paddingRight: spacing.sm,
  },
  signOutButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: hp("1%"),
    backgroundColor: "#7F1D1D",
    alignItems: "center",
  },
  signOutButtonText: {
    fontSize: hp("1.8%"),
    color: "#FCA5A5",
    fontWeight: "500",
  },
  buttonRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  signInButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: hp("1%"),
    backgroundColor: "#2563EB",
    alignItems: "center",
  },
  signInButtonText: {
    fontSize: hp("1.8%"),
    color: "#FFFFFF",
    fontWeight: "500",
  },
  buttonDisabled: {
    backgroundColor: "#374151",
  },
  debugButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: hp("0.5%"),
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#374151",
    alignSelf: "flex-start",
  },
  debugButtonText: {
    fontSize: hp("1.4%"),
    color: "#6B7280",
  },
  logOutButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: hp("1%"),
    backgroundColor: "#7F1D1D",
    alignSelf: "flex-start",
  },
  logOutButtonText: {
    fontSize: hp("1.6%"),
    color: "#FCA5A5",
    fontWeight: "500",
  },
  // Device status styles
  deviceStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  deviceStatusLabel: {
    fontSize: hp("1.5%"),
    color: "#9CA3AF",
    marginRight: spacing.sm,
  },
  deviceStatusValue: {
    fontSize: hp("1.5%"),
    fontWeight: "600",
  },
  deviceStatusMain: {
    color: "#10B981",
  },
  deviceStatusOther: {
    color: "#F59E0B",
  },
  // Account button row styles
  accountButtonRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  accountButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: hp("1%"),
    alignItems: "center",
    justifyContent: "center",
  },
  accountButtonPrimary: {
    backgroundColor: "#2563EB",
  },
  accountButtonPrimaryText: {
    fontSize: hp("1.6%"),
    color: "#FFFFFF",
    fontWeight: "600",
  },
  accountButtonDanger: {
    backgroundColor: "#7F1D1D",
  },
  accountButtonDangerText: {
    fontSize: hp("1.6%"),
    color: "#FCA5A5",
    fontWeight: "600",
  },
  accountButtonAdmin: {
    backgroundColor: "#1F2937",
    borderWidth: 1,
    borderColor: "#374151",
  },
  accountButtonAdminText: {
    fontSize: hp("1.6%"),
    color: "#9CA3AF",
    fontWeight: "500",
  },
  // Legacy styles (kept for compatibility)
  registerDeviceButton: {
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: hp("1%"),
    backgroundColor: "#2563EB",
    alignSelf: "flex-start",
  },
  registerDeviceButtonText: {
    fontSize: hp("1.6%"),
    color: "#FFFFFF",
    fontWeight: "500",
  },
  // Routes styles
  loadingText: {
    fontSize: hp("1.6%"),
    color: "#6B7280",
    fontStyle: "italic",
    marginTop: spacing.sm,
  },
  routesContainer: {
    marginTop: spacing.sm,
  },
  routeSection: {
    marginBottom: spacing.sm,
  },
  routeSectionDragging: {
    opacity: 0.9,
    shadowColor: "#60A5FA",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  routeHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    backgroundColor: "#1F2937",
    borderRadius: hp("0.8%"),
    minHeight: hp("5%"),
  },
  routeHeaderDragging: {
    backgroundColor: "#2563EB",
  },
  dragHandle: {
    width: hp("2%"),
    alignItems: "center",
    marginRight: spacing.sm,
  },
  dragHandleText: {
    fontSize: hp("2%"),
    color: "#9CA3AF",
  },
  editButtonTextActive: {
    color: "#22C55E",
  },
  routeColorBar: {
    width: 4,
    height: hp("2.5%"),
    borderRadius: 2,
    marginRight: spacing.sm,
  },
  routeExpandIcon: {
    fontSize: hp("1.4%"),
    color: "#9CA3AF",
    marginRight: spacing.sm,
    width: hp("2%"),
  },
  routeName: {
    fontSize: hp("1.8%"),
    color: "#F9FAFB",
    fontWeight: "600",
    flex: 1,
  },
  routeCount: {
    fontSize: hp("1.4%"),
    color: "#6B7280",
  },
  routeWells: {
    marginLeft: spacing.md,
    marginTop: spacing.xs,
    borderLeftWidth: 1,
    borderLeftColor: "#374151",
    paddingLeft: spacing.sm,
  },
  wellRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.xs,
  },
  checkbox: {
    width: hp("2.2%"),
    height: hp("2.2%"),
    borderRadius: hp("0.4%"),
    borderWidth: 2,
    borderColor: "#4B5563",
    marginRight: spacing.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxChecked: {
    backgroundColor: "#2563EB",
    borderColor: "#2563EB",
  },
  checkboxPartial: {
    backgroundColor: "#4B5563",
    borderColor: "#4B5563",
  },
  checkmark: {
    color: "#FFFFFF",
    fontSize: hp("1.4%"),
    fontWeight: "bold",
  },
  wellName: {
    fontSize: hp("1.6%"),
    color: "#D1D5DB",
    flex: 1,
  },
  wellNameDown: {
    color: "#6B7280",
  },
  wellNameAll: {
    fontSize: hp("1.6%"),
    color: "#9CA3AF",
    fontStyle: "italic",
  },
  wellRowDown: {
    backgroundColor: "rgba(127, 29, 29, 0.2)",
    borderRadius: hp("0.4%"),
    marginVertical: 1,
  },
  downBadge: {
    fontSize: hp("1.2%"),
    color: "#EF4444",
    fontWeight: "600",
    marginLeft: spacing.sm,
  },
  // Well Alert styles
  alertEnableRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#1F2937",
    borderRadius: hp("0.8%"),
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  alertEnableInfo: {
    flex: 1,
  },
  alertEnableLabel: {
    fontSize: hp("1.7%"),
    color: "#F9FAFB",
    fontWeight: "600",
  },
  alertEnableHint: {
    fontSize: hp("1.4%"),
    color: "#9CA3AF",
    marginTop: 2,
  },
  alertThresholdSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: "#374151",
  },
  alertThresholdLabel: {
    fontSize: hp("1.6%"),
    color: "#D1D5DB",
    marginBottom: spacing.xs,
  },
  alertThresholdButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  alertThresholdButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    marginHorizontal: 2,
    backgroundColor: "#1F2937",
    borderRadius: hp("0.8%"),
    borderWidth: 1,
    borderColor: "#374151",
    alignItems: "center",
  },
  alertThresholdButtonActive: {
    backgroundColor: "#2563EB",
    borderColor: "#2563EB",
  },
  alertThresholdButtonText: {
    fontSize: hp("1.8%"),
    color: "#9CA3AF",
    fontWeight: "500",
  },
  alertThresholdButtonTextActive: {
    color: "#FFFFFF",
  },
  alertThresholdDisplay: {
    backgroundColor: "#1F2937",
    borderRadius: hp("1%"),
    borderWidth: 1,
    borderColor: "#374151",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    marginBottom: spacing.md,
  },
  alertThresholdDisplayText: {
    fontSize: hp("3%"),
    fontWeight: "600",
    color: "#F9FAFB",
  },
  alertThresholdDisplayHint: {
    fontSize: hp("1.4%"),
    color: "#6B7280",
    marginTop: spacing.xs,
  },
  feetInchesModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    justifyContent: "center",
    alignItems: "center",
  },
  feetInchesModalContent: {
    backgroundColor: "#111827",
    borderRadius: hp("2%"),
    padding: spacing.lg,
    width: "85%",
    maxWidth: 340,
  },
  feetInchesPickerRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  feetInchesPickerColumn: {
    flex: 1,
    alignItems: "center",
  },
  feetInchesPickerLabel: {
    fontSize: hp("1.6%"),
    color: "#9CA3AF",
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  feetInchesWheelColumn: {
    flex: 1,
    alignItems: "center",
  },
  feetInchesWheelContainer: {
    height: 250,
    position: "relative",
    overflow: "hidden",
    width: "100%",
  },
  feetInchesWheelHighlight: {
    position: "absolute",
    top: 100,
    left: 10,
    right: 10,
    height: 50,
    backgroundColor: "#2563EB",
    borderRadius: 8,
    zIndex: 1,
  },
  feetInchesWheelList: {
    height: 250,
    zIndex: 2,
  },
  feetInchesWheelRow: {
    height: 50,
    justifyContent: "center",
    alignItems: "center",
  },
  feetInchesWheelText: {
    fontSize: hp("2.8%"),
    color: "#6B7280",
    textAlign: "center",
  },
  feetInchesWheelTextSelected: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  feetInchesPicker: {
    width: "100%",
    height: 150,
    color: "#FFFFFF",
  },
  feetInchesPickerItem: {
    fontSize: hp("2.5%"),
    color: "#FFFFFF",
  },
  feetInchesModalButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.lg,
  },
  feetInchesModalCancel: {
    flex: 1,
    paddingVertical: spacing.sm,
    marginRight: spacing.sm,
    backgroundColor: "#374151",
    borderRadius: hp("0.8%"),
    alignItems: "center",
  },
  feetInchesModalCancelText: {
    fontSize: hp("1.6%"),
    color: "#9CA3AF",
  },
  feetInchesModalConfirm: {
    flex: 1,
    paddingVertical: spacing.sm,
    marginLeft: spacing.sm,
    backgroundColor: "#2563EB",
    borderRadius: hp("0.8%"),
    alignItems: "center",
  },
  feetInchesModalConfirmText: {
    fontSize: hp("1.6%"),
    color: "#FFFFFF",
    fontWeight: "600",
  },
  alertPickerContainer: {
    backgroundColor: "#1F2937",
    borderRadius: hp("1%"),
    borderWidth: 1,
    borderColor: "#374151",
    marginBottom: spacing.md,
    overflow: "hidden",
  },
  alertDualPickerContainer: {
    flexDirection: "row",
    backgroundColor: "#1F2937",
    borderRadius: hp("1%"),
    borderWidth: 1,
    borderColor: "#374151",
    marginBottom: spacing.md,
    overflow: "hidden",
  },
  alertPickerColumn: {
    flex: 1,
  },
  alertPicker: {
    color: "#F9FAFB",
    backgroundColor: Platform.OS === 'android' ? "#1F2937" : "transparent",
  },
  alertPickerItem: {
    fontSize: hp("1.8%"),
    color: "#F9FAFB",
  },
  alertNote: {
    fontSize: hp("1.4%"),
    color: "#6B7280",
    lineHeight: hp("2%"),
    fontStyle: "italic",
  },
  // Pull History styles
  retentionLabel: {
    fontSize: hp("1.6%"),
    color: "#D1D5DB",
    marginBottom: spacing.sm,
  },
  retentionOptions: {
    flexDirection: "row",
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  retentionButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: hp("0.8%"),
    backgroundColor: "#1F2937",
    borderWidth: 1,
    borderColor: "#374151",
    alignItems: "center",
  },
  retentionButtonActive: {
    backgroundColor: "#2563EB",
    borderColor: "#2563EB",
  },
  retentionButtonText: {
    fontSize: hp("1.6%"),
    color: "#9CA3AF",
    fontWeight: "500",
  },
  retentionButtonTextActive: {
    color: "#FFFFFF",
  },
  clearHistoryButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: hp("0.8%"),
    backgroundColor: "#7F1D1D",
    alignSelf: "flex-start",
  },
  clearHistoryButtonText: {
    fontSize: hp("1.6%"),
    color: "#FCA5A5",
    fontWeight: "500",
  },
  // Dispatch message styles
  dispatchEnableRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#1F2937",
    borderRadius: hp("0.8%"),
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  dispatchModeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#1F2937",
    borderRadius: hp("0.8%"),
    padding: spacing.sm,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: "#374151",
  },
  dispatchEnableInfo: {
    flex: 1,
  },
  dispatchEnableLabel: {
    fontSize: hp("1.7%"),
    color: "#F9FAFB",
    fontWeight: "600",
  },
  dispatchEnableHint: {
    fontSize: hp("1.4%"),
    color: "#9CA3AF",
    marginTop: 2,
  },
  dispatchSection: {
    marginTop: spacing.md,
  },
  dispatchSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  dispatchSectionTitle: {
    fontSize: hp("1.6%"),
    color: "#D1D5DB",
    fontWeight: "600",
  },
  addButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: hp("0.6%"),
    backgroundColor: "#1F2937",
    borderWidth: 1,
    borderColor: "#374151",
  },
  addButtonText: {
    fontSize: hp("1.4%"),
    color: "#60A5FA",
    fontWeight: "500",
  },
  editButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: hp("0.6%"),
    backgroundColor: "#1F2937",
    borderWidth: 1,
    borderColor: "#374151",
  },
  editButtonText: {
    fontSize: hp("1.4%"),
    color: "#60A5FA",
    fontWeight: "500",
  },
  emptyText: {
    fontSize: hp("1.5%"),
    color: "#6B7280",
    fontStyle: "italic",
  },
  recipientRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "#1F2937",
  },
  recipientInfo: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  recipientName: {
    fontSize: hp("1.6%"),
    color: "#F9FAFB",
    fontWeight: "500",
  },
  recipientDetails: {
    fontSize: hp("1.4%"),
    color: "#9CA3AF",
    marginTop: 2,
  },
  deleteButton: {
    padding: spacing.xs,
  },
  deleteButtonText: {
    fontSize: hp("1.6%"),
    color: "#EF4444",
    fontWeight: "600",
  },
  templatePreview: {
    backgroundColor: "#1F2937",
    borderRadius: hp("0.6%"),
    padding: spacing.sm,
  },
  templatePreviewText: {
    fontSize: hp("1.4%"),
    color: "#D1D5DB",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: "#111827",
    borderRadius: hp("1.5%"),
    padding: spacing.lg,
    width: "100%",
    maxWidth: 400,
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  modalTitle: {
    fontSize: hp("2.2%"),
    color: "#F9FAFB",
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  modalSubtitle: {
    fontSize: hp("1.5%"),
    color: "#9CA3AF",
    marginBottom: spacing.md,
  },
  inputLabel: {
    fontSize: hp("1.5%"),
    color: "#D1D5DB",
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  textInput: {
    backgroundColor: "#1F2937",
    borderRadius: hp("0.8%"),
    padding: spacing.sm,
    fontSize: hp("1.6%"),
    color: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#374151",
  },
  templateInput: {
    minHeight: hp("15%"),
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  channelButtons: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  channelButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: hp("0.8%"),
    backgroundColor: "#1F2937",
    borderWidth: 1,
    borderColor: "#374151",
    alignItems: "center",
  },
  channelButtonActive: {
    backgroundColor: "#2563EB",
    borderColor: "#2563EB",
  },
  channelButtonText: {
    fontSize: hp("1.6%"),
    color: "#9CA3AF",
    fontWeight: "500",
  },
  channelButtonTextActive: {
    color: "#FFFFFF",
  },
  fieldButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  fieldButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: hp("0.6%"),
    backgroundColor: "#374151",
  },
  fieldButtonText: {
    fontSize: hp("1.4%"),
    color: "#60A5FA",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  templateHint: {
    fontSize: hp("1.3%"),
    color: "#6B7280",
    marginTop: spacing.md,
    lineHeight: hp("2%"),
  },
  modalButtons: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: hp("0.8%"),
    backgroundColor: "#374151",
    alignItems: "center",
  },
  modalCancelButtonText: {
    fontSize: hp("1.6%"),
    color: "#D1D5DB",
    fontWeight: "500",
  },
  modalSaveButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: hp("0.8%"),
    backgroundColor: "#2563EB",
    alignItems: "center",
  },
  modalSaveButtonText: {
    fontSize: hp("1.6%"),
    color: "#FFFFFF",
    fontWeight: "600",
  },
  // Custom template styles
  customTemplateToggle: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#1F2937",
    borderRadius: hp("0.8%"),
    padding: spacing.sm,
    marginTop: spacing.md,
  },
  customTemplateInfo: {
    flex: 1,
  },
  customTemplateLabel: {
    fontSize: hp("1.6%"),
    color: "#F9FAFB",
    fontWeight: "600",
  },
  customTemplateHint: {
    fontSize: hp("1.3%"),
    color: "#9CA3AF",
    marginTop: 2,
  },
  customTemplateEditor: {
    marginTop: spacing.sm,
  },
  customTemplateInput: {
    minHeight: hp("10%"),
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  customFieldButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  customFieldButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: hp("0.6%"),
    backgroundColor: "#374151",
  },
  customFieldButtonText: {
    fontSize: hp("1.3%"),
    color: "#60A5FA",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  customBadge: {
    color: "#10B981",
    fontWeight: "700",
  },
  // New improved modal styles
  recipientModalContent: {
    backgroundColor: "#111827",
    borderRadius: hp("2%"),
    padding: spacing.lg,
    width: "100%",
    maxWidth: 420,
    maxHeight: "90%",
    borderWidth: 1,
    borderColor: "#374151",
  },
  sectionBox: {
    backgroundColor: "#1F2937",
    borderRadius: hp("1%"),
    padding: spacing.md,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: "#374151",
  },
  sectionLabel: {
    fontSize: hp("1.8%"),
    color: "#F9FAFB",
    fontWeight: "600",
    marginBottom: spacing.xs,
  },
  sectionHint: {
    fontSize: hp("1.4%"),
    color: "#9CA3AF",
    marginBottom: spacing.sm,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  channelButtonsLarge: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  channelButtonLarge: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: hp("1%"),
    backgroundColor: "#374151",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#374151",
  },
  channelButtonLargeActive: {
    backgroundColor: "#1E3A5F",
    borderColor: "#2563EB",
  },
  channelButtonLargeText: {
    fontSize: hp("1.8%"),
    color: "#9CA3AF",
    fontWeight: "600",
  },
  channelButtonLargeTextActive: {
    color: "#60A5FA",
  },
  fieldLabel: {
    fontSize: hp("1.5%"),
    color: "#D1D5DB",
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  fieldInput: {
    backgroundColor: "#111827",
    borderRadius: hp("0.8%"),
    padding: spacing.sm,
    fontSize: hp("1.7%"),
    color: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#374151",
  },
  templateEditorSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: "#374151",
  },
  templateTextArea: {
    backgroundColor: "#111827",
    borderRadius: hp("0.8%"),
    padding: spacing.sm,
    fontSize: hp("1.6%"),
    color: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#374151",
    minHeight: hp("12%"),
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    textAlignVertical: "top",
  },
  insertFieldRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  insertFieldButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: hp("0.8%"),
    backgroundColor: "#374151",
    borderWidth: 1,
    borderColor: "#4B5563",
  },
  insertFieldButtonText: {
    fontSize: hp("1.5%"),
    color: "#60A5FA",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontWeight: "500",
  },
  fieldHintBox: {
    fontSize: hp("1.3%"),
    color: "#6B7280",
    marginTop: spacing.md,
    lineHeight: hp("2%"),
    backgroundColor: "#111827",
    padding: spacing.sm,
    borderRadius: hp("0.6%"),
  },
  previewLabel: {
    fontSize: hp("1.5%"),
    color: "#10B981",
    fontWeight: "600",
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  previewBox: {
    backgroundColor: "#0D1117",
    borderRadius: hp("0.8%"),
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "#10B981",
    borderStyle: "dashed",
  },
  previewText: {
    fontSize: hp("1.6%"),
    color: "#E5E7EB",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: hp("2.4%"),
  },
  modalButtonsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: hp("1%"),
    backgroundColor: "#374151",
    alignItems: "center",
  },
  modalCancelBtnText: {
    fontSize: hp("1.7%"),
    color: "#D1D5DB",
    fontWeight: "600",
  },
  modalSaveBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: hp("1%"),
    backgroundColor: "#2563EB",
    alignItems: "center",
  },
  modalSaveBtnText: {
    fontSize: hp("1.7%"),
    color: "#FFFFFF",
    fontWeight: "600",
  },
  // Debug Password Modal styles
  debugPasswordModal: {
    backgroundColor: "#111827",
    borderRadius: hp("1.5%"),
    padding: spacing.lg,
    width: "90%",
    maxWidth: 320,
    borderWidth: 1,
    borderColor: "#374151",
  },
  debugPasswordTitle: {
    fontSize: hp("2%"),
    color: "#F9FAFB",
    fontWeight: "600",
    marginBottom: spacing.md,
    textAlign: "center",
  },
  debugPasswordInput: {
    backgroundColor: "#1F2937",
    borderRadius: hp("0.8%"),
    padding: spacing.sm,
    fontSize: hp("1.7%"),
    color: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#374151",
    textAlign: "center",
  },
  debugPasswordButtons: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  debugPasswordCancel: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: hp("0.8%"),
    backgroundColor: "#374151",
    alignItems: "center",
  },
  debugPasswordCancelText: {
    fontSize: hp("1.6%"),
    color: "#D1D5DB",
    fontWeight: "500",
  },
  debugPasswordSubmit: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: hp("0.8%"),
    backgroundColor: "#2563EB",
    alignItems: "center",
  },
  debugPasswordSubmitText: {
    fontSize: hp("1.6%"),
    color: "#FFFFFF",
    fontWeight: "600",
  },
  // Register Device Confirmation Modal styles
  registerConfirmModal: {
    backgroundColor: "#111827",
    borderRadius: hp("1.5%"),
    padding: spacing.lg,
    width: "90%",
    maxWidth: 360,
    borderWidth: 1,
    borderColor: "#374151",
  },
  registerConfirmTitle: {
    fontSize: hp("2.2%"),
    color: "#F9FAFB",
    fontWeight: "700",
    marginBottom: spacing.xs,
    textAlign: "center",
  },
  registerConfirmSubtitle: {
    fontSize: hp("1.5%"),
    color: "#9CA3AF",
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  registerConfirmLabel: {
    fontSize: hp("1.5%"),
    color: "#D1D5DB",
    marginBottom: spacing.xs,
  },
  registerConfirmInput: {
    backgroundColor: "#1F2937",
    borderRadius: hp("0.8%"),
    padding: spacing.sm,
    fontSize: hp("1.7%"),
    color: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#374151",
    marginBottom: spacing.md,
  },
  registerConfirmError: {
    fontSize: hp("1.4%"),
    color: "#EF4444",
    textAlign: "center",
    marginBottom: spacing.md,
  },
  registerConfirmButtons: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  registerConfirmCancel: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: hp("0.8%"),
    backgroundColor: "#374151",
    alignItems: "center",
  },
  registerConfirmCancelText: {
    fontSize: hp("1.6%"),
    color: "#D1D5DB",
    fontWeight: "500",
  },
  registerConfirmSubmit: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: hp("0.8%"),
    backgroundColor: "#2563EB",
    alignItems: "center",
  },
  registerConfirmSubmitText: {
    fontSize: hp("1.6%"),
    color: "#FFFFFF",
    fontWeight: "600",
  },
});
