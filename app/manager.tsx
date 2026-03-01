// app/manager.tsx
// Manager screen - password protected access to admin functions
// - Driver registration approvals (Firebase)
// - Approved drivers list
// - Debug logs

import { useRouter } from "expo-router";
import React, { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useFocusEffect } from "@react-navigation/native";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Share,
  ActivityIndicator,
  RefreshControl,
  PanResponder,
  GestureResponderEvent,
  PanResponderGestureState,
  Modal,
} from "react-native";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { useAppAlert } from "../components/AppAlert";
import { SafeAreaView } from "react-native-safe-area-context";
import { getLogs, clearLogs, getLogsAsText } from "../src/services/debugLog";
import { debugGetRawHistory } from "../src/services/pullHistory";
import { fetchSystemLogs, cleanupOldLogs, SystemLogEntry } from "../src/services/systemLog";
import {
  getCompanyDevices,
  registerCompanyDevice,
  removeCompanyDevice,
  isCompanyDevice,
  getDeviceId,
} from "../src/services/driverAuth";

// Firebase configuration
const FIREBASE_DATABASE_URL = "https://wellbuilt-sync-default-rtdb.firebaseio.com";
const FIREBASE_API_KEY = "AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI";

const DRIVERS_PENDING = "drivers/pending";
const DRIVERS_APPROVED = "drivers/approved";

// Firebase helpers
const buildFirebaseUrl = (path: string): string => {
  let url = `${FIREBASE_DATABASE_URL}/${path}.json`;
  if (FIREBASE_API_KEY) {
    url += `?auth=${FIREBASE_API_KEY}`;
  }
  return url;
};

const firebaseGet = async (path: string): Promise<any> => {
  const response = await fetch(buildFirebaseUrl(path));
  if (!response.ok) throw new Error(`Firebase GET failed (${response.status})`);
  return response.json();
};

const firebasePut = async (path: string, data: any): Promise<void> => {
  const response = await fetch(buildFirebaseUrl(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error(`Firebase PUT failed (${response.status})`);
};

const firebaseDelete = async (path: string): Promise<void> => {
  const response = await fetch(buildFirebaseUrl(path), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error(`Firebase DELETE failed (${response.status})`);
};

// Generate UUID
const generateUUID = (): string => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

interface PendingRegistration {
  key: string;
  displayName: string;
  passcodeHash: string;
  deviceId: string;
  requestedAt: string;
}

interface Driver {
  key: string;
  displayName: string;
  approvedAt: string;
  active: boolean;
  isAdmin?: boolean;
  isViewer?: boolean;
}

interface CompanyDevice {
  deviceId: string;
  nickname: string;
  registeredAt: string;
  modelName?: string;
  deviceName?: string;
  brand?: string;
  osName?: string;
  osVersion?: string;
  lastDriver?: string;
  lastLoginAt?: string;
  loginHistory?: Record<string, { driver: string; at: string }>;
}

type Tab = 'registrations' | 'drivers' | 'devices' | 'production' | 'logs';

// Unified log entry type for combined view
interface UnifiedLogEntry {
  id: string;
  type: 'local' | 'system';
  level: string;
  message: string;
  timestamp: Date;
  // System log specific
  event?: string;
  details?: string;
  device?: string;
  driver?: string;
}

export default function ManagerScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const alert = useAppAlert();
  const [activeTab, setActiveTab] = useState<Tab>('registrations');
  const [logs, setLogs] = useState<ReturnType<typeof getLogs>>([]);
  const [pendingRegistrations, setPendingRegistrations] = useState<PendingRegistration[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [companyDevices, setCompanyDevices] = useState<CompanyDevice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [deviceNickname, setDeviceNickname] = useState('');
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [isCurrentDeviceRegistered, setIsCurrentDeviceRegistered] = useState(false);
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);
  // Role selection for approval: 'user' (default), 'viewer', 'admin'
  const [selectedRole, setSelectedRole] = useState<'viewer' | 'user' | 'admin'>('user');

  // Tab order for swipe navigation
  const tabs: Tab[] = ['registrations', 'drivers', 'devices', 'production', 'logs'];

  // System logs state
  const [systemLogs, setSystemLogs] = useState<SystemLogEntry[]>([]);
  const [systemLogsLoading, setSystemLogsLoading] = useState(false);
  const [sysLogDays, setSysLogDays] = useState(7); // 7 or 30 days
  const [logLevelFilter, setLogLevelFilter] = useState<'all' | 'warn' | 'error'>('all');
  const [logSourceFilter, setLogSourceFilter] = useState<'all' | 'local' | 'system'>('all');

  // Production tab state
  interface ProductionEntry {
    wellName: string;
    date: string;
    afrBbls: number;
    windowBbls: number;
    overnightBbls: number;
    pullCount: number;
    updatedAt: string;
  }
  const [productionData, setProductionData] = useState<ProductionEntry[]>([]);
  const [productionLoading, setProductionLoading] = useState(false);
  const [productionDays, setProductionDays] = useState(7);

  // Selection mode state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedLogs, setSelectedLogs] = useState<Set<string>>(new Set());

  // Swipe gesture handler
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (
        _evt: GestureResponderEvent,
        gestureState: PanResponderGestureState
      ) => {
        // Only capture horizontal swipes (dx > dy) that are substantial enough
        const { dx, dy } = gestureState;
        return Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 20;
      },
      onPanResponderRelease: (
        _evt: GestureResponderEvent,
        gestureState: PanResponderGestureState
      ) => {
        const { dx } = gestureState;
        const SWIPE_THRESHOLD = 50;

        if (dx < -SWIPE_THRESHOLD) {
          // Swipe left - go to next tab
          setActiveTab((current) => {
            const idx = tabs.indexOf(current);
            return idx < tabs.length - 1 ? tabs[idx + 1] : current;
          });
        } else if (dx > SWIPE_THRESHOLD) {
          // Swipe right - go to previous tab
          setActiveTab((current) => {
            const idx = tabs.indexOf(current);
            return idx > 0 ? tabs[idx - 1] : current;
          });
        }
      },
    })
  ).current;

  // Load logs
  const loadLogs = useCallback(() => {
    setLogs(getLogs());
  }, []);

  // Load system logs from Firebase
  const loadSystemLogs = useCallback(async () => {
    setSystemLogsLoading(true);
    try {
      const logs = await fetchSystemLogs(sysLogDays);
      setSystemLogs(logs);
    } catch (error) {
      console.error('[Manager] Load system logs error:', error);
    } finally {
      setSystemLogsLoading(false);
    }
  }, [sysLogDays]);

  // Load production data from Firebase
  const loadProductionData = useCallback(async () => {
    setProductionLoading(true);
    try {
      const data = await firebaseGet('production');
      if (!data) {
        setProductionData([]);
        return;
      }

      const entries: ProductionEntry[] = [];
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - productionDays);
      const cutoffStr = cutoffDate.toISOString().slice(0, 10);

      for (const wellKey of Object.keys(data)) {
        const wellData = data[wellKey];
        const wellName = wellData.wellName || wellKey.replace(/_/g, ' ');

        for (const dateKey of Object.keys(wellData)) {
          // Skip 'wellName' and 'updated' metadata keys
          if (dateKey === 'wellName' || dateKey === 'updated') continue;
          // Filter by date range
          if (dateKey < cutoffStr) continue;

          const dayData = wellData[dateKey];
          if (dayData && typeof dayData === 'object' && ('a' in dayData || 'w' in dayData || 'o' in dayData)) {
            entries.push({
              wellName,
              date: dateKey,
              afrBbls: dayData.a || 0,
              windowBbls: dayData.w || 0,
              overnightBbls: dayData.o || 0,
              pullCount: dayData.n || 0,
              updatedAt: dayData.u || '',
            });
          }
        }
      }

      // Sort by date descending, then well name
      entries.sort((a, b) => {
        const dateCompare = b.date.localeCompare(a.date);
        if (dateCompare !== 0) return dateCompare;
        return a.wellName.localeCompare(b.wellName);
      });

      setProductionData(entries);
    } catch (error) {
      console.error('[Manager] Load production data error:', error);
    } finally {
      setProductionLoading(false);
    }
  }, [productionDays]);

  // Reload when days filter changes
  useEffect(() => {
    if (activeTab === 'logs' && (logSourceFilter === 'all' || logSourceFilter === 'system')) {
      loadSystemLogs();
    }
  }, [sysLogDays]);

  // Reload production data when days filter changes
  useEffect(() => {
    if (activeTab === 'production') {
      loadProductionData();
    }
  }, [productionDays]);

  // Clear selection when leaving logs tab or changing source filter
  useEffect(() => {
    if (activeTab !== 'logs') {
      setSelectionMode(false);
      setSelectedLogs(new Set());
    }
  }, [activeTab]);

  // Build unified log list
  const unifiedLogs = React.useMemo((): UnifiedLogEntry[] => {
    const result: UnifiedLogEntry[] = [];

    // Add local logs if showing all or local
    if (logSourceFilter === 'all' || logSourceFilter === 'local') {
      logs.forEach((log, index) => {
        result.push({
          id: `local-${index}-${log.timestamp.getTime()}`,
          type: 'local',
          level: log.level,
          message: log.message,
          timestamp: log.timestamp,
        });
      });
    }

    // Add system logs if showing all or system
    if (logSourceFilter === 'all' || logSourceFilter === 'system') {
      systemLogs.forEach((log) => {
        result.push({
          id: `system-${log.id || log.timestamp}`,
          type: 'system',
          level: log.level,
          message: log.event,
          timestamp: new Date(log.timestamp),
          event: log.event,
          details: log.details || undefined,
          device: log.device,
          driver: log.driver || undefined,
        });
      });
    }

    // Sort by timestamp (newest first)
    result.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply level filter
    if (logLevelFilter === 'warn') {
      return result.filter(log => log.level === 'warn' || log.level === 'error');
    }
    if (logLevelFilter === 'error') {
      return result.filter(log => log.level === 'error');
    }

    return result;
  }, [logs, systemLogs, logSourceFilter, logLevelFilter]);

  // Handle cleanup old logs
  const handleCleanupLogs = async () => {
    alert.show(
      'Cleanup Old Logs',
      'Delete system logs older than 7 days?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setProcessing('cleanup');
            try {
              const count = await cleanupOldLogs();
              await loadSystemLogs();
              alert.show('Cleanup Complete', `Deleted ${count} old log entries.`);
            } catch (error) {
              alert.show('Error', 'Could not cleanup logs');
            } finally {
              setProcessing(null);
            }
          },
        },
      ]
    );
  };

  // Handle long press to enter selection mode
  const handleLogLongPress = (logId: string) => {
    setSelectionMode(true);
    setSelectedLogs(new Set([logId]));
  };

  // Toggle log selection
  const toggleLogSelection = (logId: string) => {
    setSelectedLogs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(logId)) {
        newSet.delete(logId);
      } else {
        newSet.add(logId);
      }
      // Exit selection mode if nothing selected
      if (newSet.size === 0) {
        setSelectionMode(false);
      }
      return newSet;
    });
  };

  // Cancel selection mode
  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedLogs(new Set());
  };

  // Select all visible logs
  const selectAllLogs = () => {
    const allIds = unifiedLogs.map(log => log.id);
    setSelectedLogs(new Set(allIds));
  };

  // Delete selected logs
  const handleDeleteSelected = async () => {
    const localCount = Array.from(selectedLogs).filter(id => id.startsWith('local-')).length;
    const systemCount = Array.from(selectedLogs).filter(id => id.startsWith('system-')).length;

    let message = `Delete ${selectedLogs.size} selected logs?`;
    if (localCount > 0 && systemCount > 0) {
      message = `Delete ${localCount} local and ${systemCount} system logs?`;
    } else if (localCount > 0) {
      message = `Delete ${localCount} local logs?`;
    } else if (systemCount > 0) {
      message = `Delete ${systemCount} system logs?`;
    }

    alert.show(
      'Delete Logs',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setProcessing('delete-logs');
            try {
              // Delete local logs by clearing and re-adding unselected ones
              if (localCount > 0) {
                // For now, we can only clear ALL local logs
                // TODO: implement selective delete in debugLog service
                clearLogs();
              }

              // Delete system logs from Firebase
              if (systemCount > 0) {
                const systemIds = Array.from(selectedLogs)
                  .filter(id => id.startsWith('system-'))
                  .map(id => id.replace('system-', ''));

                // Delete each system log from Firebase
                for (const id of systemIds) {
                  try {
                    await firebaseDelete(`logs/${id}`);
                  } catch (e) {
                    console.error('[Manager] Delete system log error:', e);
                  }
                }
              }

              // Refresh
              loadLogs();
              await loadSystemLogs();

              setSelectionMode(false);
              setSelectedLogs(new Set());

              alert.show('Deleted', `Removed ${selectedLogs.size} logs`);
            } catch (error) {
              console.error('[Manager] Delete logs error:', error);
              alert.show('Error', 'Could not delete some logs');
            } finally {
              setProcessing(null);
            }
          },
        },
      ]
    );
  };

  // Load pending registrations from Firebase
  const loadPendingRegistrations = async () => {
    try {
      const data = await firebaseGet(DRIVERS_PENDING);
      const pending: PendingRegistration[] = [];
      if (data) {
        for (const key of Object.keys(data)) {
          pending.push({ key, ...data[key] });
        }
      }
      // Sort by requestedAt (newest first)
      pending.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
      setPendingRegistrations(pending);
    } catch (error) {
      console.error('[Manager] Load pending error:', error);
    }
  };

  // Load company devices from Firebase
  const loadCompanyDevices = async () => {
    try {
      const data = await getCompanyDevices();
      const devices: CompanyDevice[] = [];
      if (data) {
        for (const deviceId of Object.keys(data)) {
          const device = data[deviceId];
          devices.push({
            deviceId,
            nickname: device.nickname || 'Unnamed Device',
            registeredAt: device.registeredAt,
            modelName: device.modelName,
            deviceName: device.deviceName,
            brand: device.brand,
            osName: device.osName,
            osVersion: device.osVersion,
            lastDriver: device.lastDriver,
            lastLoginAt: device.lastLoginAt,
            loginHistory: (device as any).loginHistory,
          });
        }
      }
      // Sort by registeredAt (newest first)
      devices.sort((a, b) => new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime());
      setCompanyDevices(devices);

      // Check if current device is registered
      const thisDeviceId = await getDeviceId();
      setCurrentDeviceId(thisDeviceId);
      const isRegistered = await isCompanyDevice();
      setIsCurrentDeviceRegistered(isRegistered);
    } catch (error) {
      console.error('[Manager] Load company devices error:', error);
    }
  };

  // Load approved drivers from Firebase
  // NEW STRUCTURE: drivers/approved/{passcodeHash}/{deviceId}/
  // We need to traverse both levels to get all drivers
  const loadDrivers = async () => {
    try {
      const data = await firebaseGet(DRIVERS_APPROVED);
      const approved: Driver[] = [];
      if (data) {
        for (const hashKey of Object.keys(data)) {
          const hashNode = data[hashKey];

          // Check if this is old structure (has displayName directly) or new (nested by deviceId)
          if (hashNode.displayName) {
            // OLD STRUCTURE: {driverId: {displayName, passcodeHash, ...}}
            approved.push({ key: hashKey, ...hashNode });
          } else {
            // NEW STRUCTURE: {passcodeHash: {deviceId: {displayName, ...}}}
            for (const deviceId of Object.keys(hashNode)) {
              const driver = hashNode[deviceId];
              if (driver.displayName) {
                // Composite key for revoke: passcodeHash/deviceId
                approved.push({
                  key: `${hashKey}/${deviceId}`,
                  displayName: driver.displayName,
                  approvedAt: driver.approvedAt,
                  active: driver.active !== false,
                  isAdmin: driver.isAdmin,
                  isViewer: driver.isViewer,
                });
              }
            }
          }
        }
      }
      // Sort by displayName
      approved.sort((a, b) => a.displayName.localeCompare(b.displayName));
      setDrivers(approved);
    } catch (error) {
      console.error('[Manager] Load drivers error:', error);
    }
  };

  // Initial load
  useEffect(() => {
    setIsLoading(true);
    Promise.all([loadPendingRegistrations(), loadDrivers(), loadCompanyDevices(), loadLogs()])
      .finally(() => setIsLoading(false));
  }, []);

  // Auto-refresh based on active tab
  useFocusEffect(
    useCallback(() => {
      if (activeTab === 'logs') {
        // Load both log types for unified view
        loadLogs();
        loadSystemLogs();
        // Local logs refresh faster (2s), system logs slower (30s)
        const localInterval = setInterval(loadLogs, 2000);
        const sysInterval = setInterval(loadSystemLogs, 30000);
        return () => {
          clearInterval(localInterval);
          clearInterval(sysInterval);
        };
      } else if (activeTab === 'registrations') {
        loadPendingRegistrations();
        const interval = setInterval(loadPendingRegistrations, 10000); // Check every 10s
        return () => clearInterval(interval);
      } else if (activeTab === 'production') {
        loadProductionData();
        // No auto-refresh needed - production data updates on pulls
      } else if (activeTab === 'devices') {
        loadCompanyDevices();
        const interval = setInterval(loadCompanyDevices, 30000); // Check every 30s
        return () => clearInterval(interval);
      }
    }, [activeTab, loadLogs, loadSystemLogs, loadProductionData])
  );

  // Pull to refresh
  const onRefresh = async () => {
    setRefreshing(true);
    if (activeTab === 'registrations') {
      await loadPendingRegistrations();
    } else if (activeTab === 'drivers') {
      await loadDrivers();
    } else if (activeTab === 'devices') {
      await loadCompanyDevices();
    } else if (activeTab === 'production') {
      await loadProductionData();
    } else if (activeTab === 'logs') {
      loadLogs();
      await loadSystemLogs();
    }
    setRefreshing(false);
  };

  // State for approve modal
  const [approveModalVisible, setApproveModalVisible] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingRegistration | null>(null);

  // State for role change modal (existing drivers)
  const [roleChangeModalVisible, setRoleChangeModalVisible] = useState(false);
  const [driverToChangeRole, setDriverToChangeRole] = useState<Driver | null>(null);
  const [newRole, setNewRole] = useState<'viewer' | 'user' | 'admin'>('user');

  // Open approve modal with role selection
  const handleApprove = (reg: PendingRegistration) => {
    setPendingApproval(reg);
    setSelectedRole('user'); // Reset to default role
    setApproveModalVisible(true);
  };

  // Actually approve the driver
  const confirmApprove = async () => {
    if (!pendingApproval) return;

    setApproveModalVisible(false);
    setProcessing(pendingApproval.key);

    try {
      // Write flat format to {passcodeHash}/
      const driverData: any = {
        displayName: pendingApproval.displayName,
        approvedAt: Date.now(),
        active: true,
        isAdmin: false,
        isViewer: false,
      };

      // Set role flags based on selection
      if (selectedRole === 'admin') {
        driverData.isAdmin = true;
      } else if (selectedRole === 'viewer') {
        driverData.isViewer = true;
      }
      // 'user' role = no special flags (default driver)

      await firebasePut(`${DRIVERS_APPROVED}/${pendingApproval.passcodeHash}`, driverData);

      // Delete from pending
      await firebaseDelete(`${DRIVERS_PENDING}/${pendingApproval.key}`);

      // Refresh lists
      await Promise.all([loadPendingRegistrations(), loadDrivers()]);

      const roleText = selectedRole === 'admin' ? ' as Admin' : selectedRole === 'viewer' ? ' as Viewer' : '';
      alert.show(t('manager.approved'), `${pendingApproval.displayName} approved${roleText}`);
    } catch (error) {
      console.error('[Manager] Approve error:', error);
      alert.show(t('manager.error'), t('manager.errorApprove'));
    } finally {
      setProcessing(null);
      setPendingApproval(null);
    }
  };

  // Reject a pending registration
  const handleReject = async (reg: PendingRegistration) => {
    alert.show(
      t('manager.rejectDriver'),
      t('manager.rejectConfirm', { name: reg.displayName }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('manager.reject'),
          style: 'destructive',
          onPress: async () => {
            setProcessing(reg.key);
            try {
              await firebaseDelete(`${DRIVERS_PENDING}/${reg.key}`);
              await loadPendingRegistrations();
              alert.show(t('manager.rejected'), t('manager.rejectedMessage', { name: reg.displayName }));
            } catch (error) {
              console.error('[Manager] Reject error:', error);
              alert.show(t('manager.error'), t('manager.errorReject'));
            } finally {
              setProcessing(null);
            }
          },
        },
      ]
    );
  };

  // Open role change modal
  const handleChangeRole = (driver: Driver) => {
    setDriverToChangeRole(driver);
    // Set current role as default selection
    if (driver.isAdmin) {
      setNewRole('admin');
    } else if (driver.isViewer) {
      setNewRole('viewer');
    } else {
      setNewRole('user');
    }
    setRoleChangeModalVisible(true);
  };

  // Confirm role change
  const confirmRoleChange = async () => {
    if (!driverToChangeRole) return;

    // Determine current role
    const currentRole = driverToChangeRole.isAdmin ? 'admin' : driverToChangeRole.isViewer ? 'viewer' : 'user';
    if (newRole === currentRole) {
      setRoleChangeModalVisible(false);
      setDriverToChangeRole(null);
      return; // No change needed
    }

    setRoleChangeModalVisible(false);
    setProcessing(driverToChangeRole.key);

    try {
      const basePath = `${DRIVERS_APPROVED}/${driverToChangeRole.key}`;

      // Clear old role flags
      if (driverToChangeRole.isAdmin) {
        await firebaseDelete(`${basePath}/isAdmin`);
      }
      if (driverToChangeRole.isViewer) {
        await firebaseDelete(`${basePath}/isViewer`);
      }

      // Set new role flag
      if (newRole === 'admin') {
        await firebasePut(`${basePath}/isAdmin`, true);
      } else if (newRole === 'viewer') {
        await firebasePut(`${basePath}/isViewer`, true);
      }
      // 'user' role = no special flags

      await loadDrivers();

      const roleLabel = newRole === 'admin' ? 'Admin' : newRole === 'viewer' ? 'Viewer' : 'Driver';
      alert.show('Updated', `${driverToChangeRole.displayName} is now a ${roleLabel}`);
    } catch (error) {
      console.error('[Manager] Role change error:', error);
      alert.show(t('manager.error'), 'Could not update role');
    } finally {
      setProcessing(null);
      setDriverToChangeRole(null);
    }
  };

  // Revoke an approved driver
  const handleRevoke = async (driver: Driver) => {
    alert.show(
      t('manager.revokeAccess'),
      t('manager.revokeConfirm', { name: driver.displayName }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('manager.revoke'),
          style: 'destructive',
          onPress: async () => {
            setProcessing(driver.key);
            try {
              await firebaseDelete(`${DRIVERS_APPROVED}/${driver.key}`);
              await loadDrivers();
              alert.show(t('manager.revoked'), t('manager.revokedMessage', { name: driver.displayName }));
            } catch (error) {
              console.error('[Manager] Revoke error:', error);
              alert.show(t('manager.error'), t('manager.errorRevoke'));
            } finally {
              setProcessing(null);
            }
          },
        },
      ]
    );
  };

  // Register current device as company-owned
  const handleRegisterDevice = async () => {
    setProcessing('register');
    try {
      const result = await registerCompanyDevice(deviceNickname.trim() || undefined);
      if (result.success) {
        setShowRegisterModal(false);
        setDeviceNickname('');
        await loadCompanyDevices();
        alert.show('Device Registered', 'This device is now registered as company-owned. Login activity will be tracked.');
      } else {
        alert.show('Error', result.error || 'Could not register device');
      }
    } catch (error) {
      console.error('[Manager] Register device error:', error);
      alert.show('Error', 'Could not register device');
    } finally {
      setProcessing(null);
    }
  };

  // Remove a company device
  const handleRemoveDevice = async (device: CompanyDevice) => {
    const isCurrentDevice = device.deviceId === currentDeviceId;
    alert.show(
      'Remove Device',
      `Remove "${device.nickname}" from company devices?\n\n${isCurrentDevice ? '(This is the current device)' : ''}\n\nLogin tracking will stop for this device.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setProcessing(device.deviceId);
            try {
              const result = await removeCompanyDevice(device.deviceId);
              if (result.success) {
                await loadCompanyDevices();
                alert.show('Device Removed', `"${device.nickname}" has been removed from company devices.`);
              } else {
                alert.show('Error', 'Could not remove device');
              }
            } catch (error) {
              console.error('[Manager] Remove device error:', error);
              alert.show('Error', 'Could not remove device');
            } finally {
              setProcessing(null);
            }
          },
        },
      ]
    );
  };

  // Share logs
  const handleShareLogs = async () => {
    try {
      const text = getLogsAsText();
      if (!text) {
        alert.show(t('manager.noLogs'), t('manager.noLogsMessage'));
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

  // Clear logs
  const handleClearLogs = () => {
    alert.show(
      t('manager.clearLogs'),
      t('manager.clearLogsConfirm'),
      [
        { text: t('common.cancel'), style: "cancel" },
        {
          text: t('manager.clear'),
          style: "destructive",
          onPress: () => {
            clearLogs();
            loadLogs();
          },
        },
      ]
    );
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error': return '#EF4444';
      case 'warn': return '#F59E0B';
      default: return '#9CA3AF';
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Styled Alert Modal */}
      <alert.AlertComponent />

      {/* Register Device Modal */}
      <Modal
        visible={showRegisterModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRegisterModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Register Company Device</Text>
            <Text style={styles.modalSubtitle}>
              This device will be tracked for login activity.
            </Text>

            <TextInput
              style={styles.modalInput}
              value={deviceNickname}
              onChangeText={setDeviceNickname}
              placeholder="Device nickname (e.g., Truck 5 Tablet)"
              placeholderTextColor="#6B7280"
              autoFocus
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setShowRegisterModal(false);
                  setDeviceNickname('');
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              {processing === 'register' ? (
                <ActivityIndicator size="small" color="#10B981" />
              ) : (
                <TouchableOpacity
                  style={styles.modalRegisterButton}
                  onPress={handleRegisterDevice}
                >
                  <Text style={styles.modalRegisterText}>Register</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Approve Driver Modal */}
      <Modal
        visible={approveModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setApproveModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Approve Driver</Text>
            <Text style={styles.modalSubtitle}>
              Approve {pendingApproval?.displayName}?
            </Text>

            {/* Role Selection */}
            <View style={styles.roleSelectionContainer}>
              <Text style={styles.roleSelectionTitle}>Select Role:</Text>

              {/* Viewer Option */}
              <TouchableOpacity
                style={styles.roleOptionRow}
                onPress={() => setSelectedRole('viewer')}
              >
                <View style={[styles.roleRadio, selectedRole === 'viewer' && styles.roleRadioSelected]}>
                  {selectedRole === 'viewer' && <View style={styles.roleRadioDot} />}
                </View>
                <View style={styles.roleOptionText}>
                  <Text style={styles.roleOptionLabel}>Viewer</Text>
                  <Text style={styles.roleOptionDesc}>Can view wells, cannot submit pulls</Text>
                </View>
              </TouchableOpacity>

              {/* User/Driver Option */}
              <TouchableOpacity
                style={styles.roleOptionRow}
                onPress={() => setSelectedRole('user')}
              >
                <View style={[styles.roleRadio, selectedRole === 'user' && styles.roleRadioSelected]}>
                  {selectedRole === 'user' && <View style={styles.roleRadioDot} />}
                </View>
                <View style={styles.roleOptionText}>
                  <Text style={styles.roleOptionLabel}>Driver</Text>
                  <Text style={styles.roleOptionDesc}>Can view wells and submit pulls</Text>
                </View>
              </TouchableOpacity>

              {/* Admin Option */}
              <TouchableOpacity
                style={styles.roleOptionRow}
                onPress={() => setSelectedRole('admin')}
              >
                <View style={[styles.roleRadio, selectedRole === 'admin' && styles.roleRadioSelected]}>
                  {selectedRole === 'admin' && <View style={styles.roleRadioDot} />}
                </View>
                <View style={styles.roleOptionText}>
                  <Text style={styles.roleOptionLabel}>Admin</Text>
                  <Text style={styles.roleOptionDesc}>Can manage drivers, view performance</Text>
                </View>
              </TouchableOpacity>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setApproveModalVisible(false);
                  setPendingApproval(null);
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalApproveButton}
                onPress={confirmApprove}
              >
                <Text style={styles.modalRegisterText}>Approve</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Role Change Modal (for existing drivers) */}
      <Modal
        visible={roleChangeModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRoleChangeModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Change Role</Text>
            <Text style={styles.modalSubtitle}>
              {driverToChangeRole?.displayName}
            </Text>

            {/* Role Selection */}
            <View style={styles.roleSelectionContainer}>
              <Text style={styles.roleSelectionTitle}>Select New Role:</Text>

              {/* Viewer Option */}
              <TouchableOpacity
                style={styles.roleOptionRow}
                onPress={() => setNewRole('viewer')}
              >
                <View style={[styles.roleRadio, newRole === 'viewer' && styles.roleRadioSelected]}>
                  {newRole === 'viewer' && <View style={styles.roleRadioDot} />}
                </View>
                <View style={styles.roleOptionText}>
                  <Text style={styles.roleOptionLabel}>Viewer</Text>
                  <Text style={styles.roleOptionDesc}>Can view wells, cannot submit pulls</Text>
                </View>
              </TouchableOpacity>

              {/* Driver Option */}
              <TouchableOpacity
                style={styles.roleOptionRow}
                onPress={() => setNewRole('user')}
              >
                <View style={[styles.roleRadio, newRole === 'user' && styles.roleRadioSelected]}>
                  {newRole === 'user' && <View style={styles.roleRadioDot} />}
                </View>
                <View style={styles.roleOptionText}>
                  <Text style={styles.roleOptionLabel}>Driver</Text>
                  <Text style={styles.roleOptionDesc}>Can view wells and submit pulls</Text>
                </View>
              </TouchableOpacity>

              {/* Admin Option */}
              <TouchableOpacity
                style={styles.roleOptionRow}
                onPress={() => setNewRole('admin')}
              >
                <View style={[styles.roleRadio, newRole === 'admin' && styles.roleRadioSelected]}>
                  {newRole === 'admin' && <View style={styles.roleRadioDot} />}
                </View>
                <View style={styles.roleOptionText}>
                  <Text style={styles.roleOptionLabel}>Admin</Text>
                  <Text style={styles.roleOptionDesc}>Can manage drivers, view performance</Text>
                </View>
              </TouchableOpacity>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setRoleChangeModalVisible(false);
                  setDriverToChangeRole(null);
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalApproveButton}
                onPress={confirmRoleChange}
              >
                <Text style={styles.modalRegisterText}>Update</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{"<"}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('manager.title')}</Text>
        <View style={styles.headerActions}>
          {activeTab === 'logs' && !selectionMode && (
            <>
              <TouchableOpacity onPress={handleShareLogs} style={styles.actionButton}>
                <Text style={styles.actionText}>{t('manager.share')}</Text>
              </TouchableOpacity>
            </>
          )}
          {activeTab === 'logs' && selectionMode && (
            <>
              <TouchableOpacity onPress={selectAllLogs} style={styles.actionButton}>
                <Text style={styles.actionText}>All</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={cancelSelection} style={styles.actionButton}>
                <Text style={styles.actionText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* Performance Tracker Button */}
      <TouchableOpacity
        style={styles.performanceButton}
        onPress={() => router.push("/performance")}
      >
        <Text style={styles.performanceButtonIcon}>📊</Text>
        <View style={styles.performanceButtonText}>
          <Text style={styles.performanceButtonTitle}>Performance Tracker</Text>
          <Text style={styles.performanceButtonSubtitle}>View prediction accuracy</Text>
        </View>
        <Text style={styles.performanceButtonArrow}>→</Text>
      </TouchableOpacity>

      {/* Tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'registrations' && styles.tabActive]}
          onPress={() => setActiveTab('registrations')}
        >
          <Text style={[styles.tabText, activeTab === 'registrations' && styles.tabTextActive]}>
            {pendingRegistrations.length > 0 ? `Pending (${pendingRegistrations.length})` : 'Pending'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'drivers' && styles.tabActive]}
          onPress={() => setActiveTab('drivers')}
        >
          <Text style={[styles.tabText, activeTab === 'drivers' && styles.tabTextActive]}>
            Drivers ({drivers.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'devices' && styles.tabActive]}
          onPress={() => setActiveTab('devices')}
        >
          <Text style={[styles.tabText, activeTab === 'devices' && styles.tabTextActive]}>
            Devices ({companyDevices.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'production' && styles.tabActive]}
          onPress={() => setActiveTab('production')}
        >
          <Text style={[styles.tabText, activeTab === 'production' && styles.tabTextActive]}>
            Prod
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'logs' && styles.tabActive]}
          onPress={() => setActiveTab('logs')}
        >
          <Text style={[styles.tabText, activeTab === 'logs' && styles.tabTextActive]}>
            Logs ({unifiedLogs.length})
          </Text>
        </TouchableOpacity>
      </View>

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#2563EB" />
        </View>
      )}

      {/* Content - swipe left/right to change tabs */}
      <View style={styles.swipeContainer} {...panResponder.panHandlers}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60A5FA" />
          }
        >
        {/* REGISTRATIONS TAB */}
        {activeTab === 'registrations' && (
          <>
            {pendingRegistrations.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>{t('manager.noPending')}</Text>
              </View>
            ) : (
              pendingRegistrations.map((reg) => (
                <View key={reg.key} style={styles.regCard}>
                  <Text style={styles.regName}>{reg.displayName}</Text>
                  <Text style={styles.regDetail}>{formatDate(reg.requestedAt)}</Text>

                  {processing === reg.key ? (
                    <ActivityIndicator size="small" color="#2563EB" style={{ marginTop: 12 }} />
                  ) : (
                    <View style={styles.regActions}>
                      <TouchableOpacity
                        style={styles.approveButton}
                        onPress={() => handleApprove(reg)}
                      >
                        <Text style={styles.approveText}>{t('manager.approve')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.rejectButton}
                        onPress={() => handleReject(reg)}
                      >
                        <Text style={styles.rejectText}>{t('manager.reject')}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))
            )}
          </>
        )}

        {/* DRIVERS TAB */}
        {activeTab === 'drivers' && (
          <>
            {drivers.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>{t('manager.noDrivers')}</Text>
              </View>
            ) : (
              drivers.map((driver) => (
                <View key={driver.key} style={styles.driverCard}>
                  <View style={styles.driverInfo}>
                    <View style={styles.driverNameRow}>
                      <Text style={styles.driverName}>{driver.displayName}</Text>
                      {driver.isAdmin ? (
                        <View style={styles.adminBadge}>
                          <Text style={styles.adminBadgeText}>ADMIN</Text>
                        </View>
                      ) : driver.isViewer ? (
                        <View style={styles.viewerBadge}>
                          <Text style={styles.viewerBadgeText}>VIEWER</Text>
                        </View>
                      ) : (
                        <View style={styles.driverBadge}>
                          <Text style={styles.driverBadgeText}>DRIVER</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.driverDetail}>{formatDate(driver.approvedAt)}</Text>
                  </View>

                  {processing === driver.key ? (
                    <ActivityIndicator size="small" color="#EF4444" />
                  ) : (
                    <View style={styles.driverActions}>
                      <TouchableOpacity
                        style={styles.changeRoleButton}
                        onPress={() => handleChangeRole(driver)}
                      >
                        <Text style={styles.changeRoleText}>Role</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.revokeButton}
                        onPress={() => handleRevoke(driver)}
                      >
                        <Text style={styles.revokeText}>{t('manager.revoke')}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))
            )}
          </>
        )}

        {/* DEVICES TAB */}
        {activeTab === 'devices' && (
          <>
            {/* Register this device button */}
            {!isCurrentDeviceRegistered && (
              <TouchableOpacity
                style={styles.registerDeviceButton}
                onPress={() => setShowRegisterModal(true)}
              >
                <Text style={styles.registerDeviceButtonText}>+ Register This Device</Text>
              </TouchableOpacity>
            )}

            {companyDevices.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No company devices registered</Text>
                <Text style={styles.emptySubtext}>
                  Register devices to track login activity
                </Text>
              </View>
            ) : (
              companyDevices.map((device) => {
                const isExpanded = expandedDevice === device.deviceId;
                const isCurrentDevice = device.deviceId === currentDeviceId;
                const loginHistoryEntries = device.loginHistory
                  ? Object.entries(device.loginHistory)
                      .map(([key, entry]) => ({ key, ...entry }))
                      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
                  : [];

                return (
                  <View key={device.deviceId} style={[styles.deviceCard, isCurrentDevice && styles.deviceCardCurrent]}>
                    <TouchableOpacity
                      style={styles.deviceHeader}
                      onPress={() => setExpandedDevice(isExpanded ? null : device.deviceId)}
                    >
                      <View style={styles.deviceInfo}>
                        <View style={styles.deviceNameRow}>
                          <Text style={styles.deviceName}>{device.nickname}</Text>
                          {isCurrentDevice && (
                            <View style={styles.currentDeviceBadge}>
                              <Text style={styles.currentDeviceBadgeText}>THIS DEVICE</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.deviceModel}>
                          {device.brand} {device.modelName} ({device.osName} {device.osVersion})
                        </Text>
                        {device.lastDriver && (
                          <Text style={styles.deviceLastUser}>
                            Last: {device.lastDriver} ({formatDate(device.lastLoginAt || '')})
                          </Text>
                        )}
                      </View>
                      <Text style={styles.expandIcon}>{isExpanded ? '▼' : '▶'}</Text>
                    </TouchableOpacity>

                    {isExpanded && (
                      <View style={styles.deviceExpanded}>
                        <Text style={styles.deviceIdText}>ID: {device.deviceId.slice(0, 16)}...</Text>
                        <Text style={styles.deviceRegisteredText}>Registered: {formatDate(device.registeredAt)}</Text>

                        {/* Login History */}
                        <View style={styles.loginHistorySection}>
                          <Text style={styles.loginHistoryTitle}>Login History ({loginHistoryEntries.length})</Text>
                          {loginHistoryEntries.length === 0 ? (
                            <Text style={styles.noHistoryText}>No logins recorded yet</Text>
                          ) : (
                            loginHistoryEntries.slice(0, 10).map((entry) => (
                              <View key={entry.key} style={styles.loginHistoryEntry}>
                                <Text style={styles.loginHistoryDriver}>{entry.driver}</Text>
                                <Text style={styles.loginHistoryTime}>{formatDate(entry.at)}</Text>
                              </View>
                            ))
                          )}
                          {loginHistoryEntries.length > 10 && (
                            <Text style={styles.moreHistoryText}>...and {loginHistoryEntries.length - 10} more</Text>
                          )}
                        </View>

                        {/* Remove button */}
                        {processing === device.deviceId ? (
                          <ActivityIndicator size="small" color="#EF4444" style={{ marginTop: 12 }} />
                        ) : (
                          <TouchableOpacity
                            style={styles.removeDeviceButton}
                            onPress={() => handleRemoveDevice(device)}
                          >
                            <Text style={styles.removeDeviceText}>Remove Device</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </>
        )}

        {/* PRODUCTION TAB */}
        {activeTab === 'production' && (
          <>
            {/* Days filter */}
            <View style={styles.prodFilterRow}>
              <View style={styles.logDaysToggle}>
                <TouchableOpacity
                  style={[styles.logDaysBtn, productionDays === 3 && styles.logDaysBtnActive]}
                  onPress={() => setProductionDays(3)}
                >
                  <Text style={[styles.logDaysBtnText, productionDays === 3 && styles.logDaysBtnTextActive]}>3D</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.logDaysBtn, productionDays === 7 && styles.logDaysBtnActive]}
                  onPress={() => setProductionDays(7)}
                >
                  <Text style={[styles.logDaysBtnText, productionDays === 7 && styles.logDaysBtnTextActive]}>7D</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.logDaysBtn, productionDays === 30 && styles.logDaysBtnActive]}
                  onPress={() => setProductionDays(30)}
                >
                  <Text style={[styles.logDaysBtnText, productionDays === 30 && styles.logDaysBtnTextActive]}>30D</Text>
                </TouchableOpacity>
              </View>
              {productionLoading && <ActivityIndicator size="small" color="#2563EB" />}
            </View>

            {productionData.length === 0 && !productionLoading ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No production data yet</Text>
                <Text style={styles.emptySubtext}>
                  Production data will appear here after Cloud Functions are deployed and pulls are processed
                </Text>
              </View>
            ) : (
              (() => {
                // Group entries by date
                const byDate: Record<string, ProductionEntry[]> = {};
                productionData.forEach(entry => {
                  if (!byDate[entry.date]) byDate[entry.date] = [];
                  byDate[entry.date].push(entry);
                });

                return Object.entries(byDate).map(([date, entries]) => (
                  <View key={date} style={styles.prodDateGroup}>
                    <Text style={styles.prodDateHeader}>{date}</Text>
                    {/* Column headers */}
                    <View style={styles.prodHeaderRow}>
                      <Text style={styles.prodHeaderWell}>Well</Text>
                      <Text style={styles.prodHeaderValue}>AFR</Text>
                      <Text style={styles.prodHeaderValue}>Win</Text>
                      <Text style={styles.prodHeaderValue}>ON</Text>
                      <Text style={styles.prodHeaderPulls}>Pulls</Text>
                    </View>
                    {entries.map((entry, idx) => (
                        <View key={`${entry.wellName}-${idx}`} style={styles.prodRow}>
                          <Text style={styles.prodWellName} numberOfLines={1}>{entry.wellName}</Text>
                          <Text style={styles.prodValue}>{entry.afrBbls != null ? entry.afrBbls : '-'}</Text>
                          <Text style={styles.prodValue}>{entry.windowBbls != null ? entry.windowBbls : '-'}</Text>
                          <Text style={styles.prodValue}>{entry.overnightBbls != null ? entry.overnightBbls : '-'}</Text>
                          <Text style={styles.prodPulls}>{entry.pullCount}</Text>
                        </View>
                    ))}
                  </View>
                ));
              })()
            )}
          </>
        )}

        {/* LOGS TAB - Unified local + system logs */}
        {activeTab === 'logs' && (
          <>
            {/* Filter row: Source + Days + Level */}
            <View style={styles.logFilterRow}>
              {/* Source filter */}
              <View style={styles.logSourceToggle}>
                <TouchableOpacity
                  style={[styles.logSourceBtn, logSourceFilter === 'all' && styles.logSourceBtnActive]}
                  onPress={() => setLogSourceFilter('all')}
                >
                  <Text style={[styles.logSourceBtnText, logSourceFilter === 'all' && styles.logSourceBtnTextActive]}>All</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.logSourceBtn, logSourceFilter === 'local' && styles.logSourceBtnActive]}
                  onPress={() => setLogSourceFilter('local')}
                >
                  <Text style={[styles.logSourceBtnText, logSourceFilter === 'local' && styles.logSourceBtnTextActive]}>Local</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.logSourceBtn, logSourceFilter === 'system' && styles.logSourceBtnActive]}
                  onPress={() => setLogSourceFilter('system')}
                >
                  <Text style={[styles.logSourceBtnText, logSourceFilter === 'system' && styles.logSourceBtnTextActive]}>System</Text>
                </TouchableOpacity>
              </View>

              {/* Days toggle (only for system logs) */}
              {(logSourceFilter === 'all' || logSourceFilter === 'system') && (
                <View style={styles.logDaysToggle}>
                  <TouchableOpacity
                    style={[styles.logDaysBtn, sysLogDays === 7 && styles.logDaysBtnActive]}
                    onPress={() => setSysLogDays(7)}
                  >
                    <Text style={[styles.logDaysBtnText, sysLogDays === 7 && styles.logDaysBtnTextActive]}>7D</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.logDaysBtn, sysLogDays === 30 && styles.logDaysBtnActive]}
                    onPress={() => setSysLogDays(30)}
                  >
                    <Text style={[styles.logDaysBtnText, sysLogDays === 30 && styles.logDaysBtnTextActive]}>30D</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Second row: Level filter */}
            <View style={styles.logFilterRow2}>
              <View style={styles.logLevelToggle}>
                <TouchableOpacity
                  style={[styles.logLevelBtn, logLevelFilter === 'all' && styles.logLevelBtnActive]}
                  onPress={() => setLogLevelFilter('all')}
                >
                  <Text style={[styles.logLevelBtnText, logLevelFilter === 'all' && styles.logLevelBtnTextActive]}>All</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.logLevelBtn, logLevelFilter === 'warn' && styles.logLevelBtnActiveWarn]}
                  onPress={() => setLogLevelFilter('warn')}
                >
                  <Text style={[styles.logLevelBtnText, logLevelFilter === 'warn' && styles.logLevelBtnTextActiveWarn]}>Warn+</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.logLevelBtn, logLevelFilter === 'error' && styles.logLevelBtnActiveError]}
                  onPress={() => setLogLevelFilter('error')}
                >
                  <Text style={[styles.logLevelBtnText, logLevelFilter === 'error' && styles.logLevelBtnTextActiveError]}>Error</Text>
                </TouchableOpacity>
              </View>

              {/* Debug button */}
              <TouchableOpacity
                style={styles.debugBtn}
                onPress={async () => {
                  const debug = await debugGetRawHistory();
                  alert.show(
                    'Pull History Debug',
                    `Storage: ${debug.storageKey}\n` +
                    `Raw data: ${debug.rawData || 'null'}\n` +
                    `Parsed: ${debug.parsedCount} entries\n` +
                    `Cached: ${debug.cachedCount} entries\n\n` +
                    `Entries:\n${debug.entries.slice(0, 20).map(e =>
                      `${e.wellName} - ${e.dateTime}`
                    ).join('\n')}` +
                    (debug.entries.length > 20 ? `\n...and ${debug.entries.length - 20} more` : '')
                  );
                }}
              >
                <Text style={styles.debugBtnText}>Debug</Text>
              </TouchableOpacity>
            </View>

            {/* Selection mode bar */}
            {selectionMode && (
              <View style={styles.selectionBar}>
                {/* Select All checkbox */}
                <TouchableOpacity
                  style={styles.selectAllRow}
                  onPress={() => {
                    if (selectedLogs.size === unifiedLogs.length) {
                      // Deselect all
                      setSelectedLogs(new Set());
                    } else {
                      // Select all
                      setSelectedLogs(new Set(unifiedLogs.map(l => l.id)));
                    }
                  }}
                >
                  <View style={[
                    styles.selectAllCheckbox,
                    selectedLogs.size === unifiedLogs.length && styles.selectAllCheckboxChecked,
                    selectedLogs.size > 0 && selectedLogs.size < unifiedLogs.length && styles.selectAllCheckboxPartial,
                  ]}>
                    {selectedLogs.size === unifiedLogs.length && (
                      <Text style={styles.selectAllCheckmark}>✓</Text>
                    )}
                    {selectedLogs.size > 0 && selectedLogs.size < unifiedLogs.length && (
                      <Text style={styles.selectAllCheckmark}>−</Text>
                    )}
                  </View>
                  <Text style={styles.selectAllText}>All</Text>
                </TouchableOpacity>

                {/* Selection count */}
                <Text style={styles.selectionCount}>{selectedLogs.size} selected</Text>

                {/* Delete button with trash icon */}
                {processing === 'delete-logs' ? (
                  <ActivityIndicator size="small" color="#EF4444" />
                ) : (
                  <TouchableOpacity
                    style={[styles.deleteIconBtn, selectedLogs.size === 0 && styles.deleteIconBtnDisabled]}
                    onPress={handleDeleteSelected}
                    disabled={selectedLogs.size === 0}
                  >
                    <Text style={{ fontSize: 22, opacity: selectedLogs.size > 0 ? 1 : 0.4 }}>🗑️</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Log count */}
            <Text style={styles.logCount}>
              {unifiedLogs.length} logs
              {logSourceFilter === 'all' && ` (${logs.length} local, ${systemLogs.length} system)`}
              {systemLogsLoading && ' (loading...)'}
            </Text>

            {/* Hint for selection */}
            {!selectionMode && unifiedLogs.length > 0 && (
              <Text style={styles.logHint}>Long-press any log to select</Text>
            )}

            {/* Log entries */}
            {unifiedLogs.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No logs</Text>
                <Text style={styles.emptySubtext}>
                  Local and system logs will appear here
                </Text>
              </View>
            ) : (
              unifiedLogs.map((log) => {
                const isSelected = selectedLogs.has(log.id);
                const isLocal = log.type === 'local';

                return (
                  <TouchableOpacity
                    key={log.id}
                    style={[
                      styles.unifiedLogEntry,
                      isLocal ? styles.unifiedLogEntryLocal : styles.unifiedLogEntrySystem,
                      isSelected && styles.unifiedLogEntrySelected,
                    ]}
                    onLongPress={() => handleLogLongPress(log.id)}
                    onPress={() => selectionMode && toggleLogSelection(log.id)}
                    delayLongPress={400}
                  >
                    {/* Selection checkbox */}
                    {selectionMode && (
                      <View style={[styles.logCheckbox, isSelected && styles.logCheckboxSelected]}>
                        {isSelected && <Text style={styles.logCheckmark}>✓</Text>}
                      </View>
                    )}

                    <View style={styles.logContent}>
                      <View style={styles.logHeader}>
                        <View style={styles.logHeaderLeft}>
                          <Text style={[styles.logLevel, { color: getLevelColor(log.level) }]}>
                            {log.level.toUpperCase()}
                          </Text>
                          <View style={[styles.logTypeBadge, isLocal ? styles.logTypeBadgeLocal : styles.logTypeBadgeSystem]}>
                            <Text style={styles.logTypeBadgeText}>{isLocal ? 'LOCAL' : 'SYS'}</Text>
                          </View>
                        </View>
                        <Text style={styles.logTime}>
                          {log.timestamp.toLocaleDateString()} {log.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </View>

                      {/* Log content */}
                      {isLocal ? (
                        <Text style={styles.logMessage} selectable={!selectionMode}>
                          {log.message}
                        </Text>
                      ) : (
                        <>
                          <Text style={styles.sysLogEvent}>{log.event}</Text>
                          {log.details && (
                            <Text style={styles.sysLogDetails}>{log.details}</Text>
                          )}
                          <View style={styles.sysLogMeta}>
                            <Text style={styles.sysLogDevice}>{log.device}</Text>
                            {log.driver && (
                              <Text style={styles.sysLogDriver}>{log.driver}</Text>
                            )}
                          </View>
                        </>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </>
        )}
        </ScrollView>
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
  actionButton: {
    padding: 8,
  },
  actionText: {
    color: "#60A5FA",
    fontSize: 14,
    fontWeight: "500",
  },
  clearText: {
    color: "#EF4444",
  },
  tabRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#1F2937",
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: "#2563EB",
  },
  tabText: {
    color: "#6B7280",
    fontSize: 14,
    fontWeight: "500",
  },
  tabTextActive: {
    color: "#F9FAFB",
  },
  loadingOverlay: {
    position: "absolute",
    top: 100,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
  },
  swipeContainer: {
    flex: 1,
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
  // Registration styles
  regCard: {
    backgroundColor: "#1F2937",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#F59E0B",
  },
  regName: {
    color: "#F9FAFB",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 4,
  },
  regDetail: {
    color: "#9CA3AF",
    fontSize: 13,
    marginBottom: 2,
  },
  regActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 12,
  },
  approveButton: {
    flex: 1,
    backgroundColor: "#10B981",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  approveText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  rejectButton: {
    flex: 1,
    backgroundColor: "#374151",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  rejectText: {
    color: "#EF4444",
    fontSize: 14,
    fontWeight: "600",
  },
  // Driver styles
  driverCard: {
    backgroundColor: "#1F2937",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  driverInfo: {
    flex: 1,
  },
  driverNameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  driverName: {
    color: "#F9FAFB",
    fontSize: 16,
    fontWeight: "600",
  },
  adminBadge: {
    backgroundColor: "#2563EB",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
  },
  adminBadgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "600",
  },
  viewerBadge: {
    backgroundColor: "#6B7280",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
  },
  viewerBadgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "600",
  },
  driverBadge: {
    backgroundColor: "#10B981",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
  },
  driverBadgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "600",
  },
  driverDetail: {
    color: "#6B7280",
    fontSize: 13,
    marginTop: 2,
  },
  driverActions: {
    flexDirection: 'column',
    gap: 6,
    alignItems: 'flex-end',
  },
  changeRoleButton: {
    backgroundColor: "#1E3A5F",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#2563EB",
  },
  changeRoleText: {
    color: "#60A5FA",
    fontSize: 11,
    fontWeight: "500",
  },
  revokeButton: {
    backgroundColor: "#374151",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  revokeText: {
    color: "#EF4444",
    fontSize: 11,
    fontWeight: "500",
  },
  // Debug button styles
  debugButtonRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: 8,
  },
  debugHistoryButton: {
    backgroundColor: "#374151",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#4B5563",
  },
  debugHistoryButtonText: {
    color: "#9CA3AF",
    fontSize: 13,
    fontWeight: "500",
  },
  // Log styles
  logCount: {
    color: "#6B7280",
    fontSize: 12,
    textAlign: "center",
    paddingVertical: 8,
  },
  logEntry: {
    backgroundColor: "#1F2937",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
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
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#1F2937',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    color: '#F9FAFB',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  modalSubtitle: {
    color: '#9CA3AF',
    fontSize: 14,
    marginBottom: 20,
  },
  modalInput: {
    backgroundColor: '#374151',
    borderRadius: 8,
    padding: 14,
    color: '#F9FAFB',
    fontSize: 16,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalCancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  modalCancelText: {
    color: '#9CA3AF',
    fontSize: 14,
    fontWeight: '500',
  },
  modalRegisterButton: {
    backgroundColor: '#10B981',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  modalApproveButton: {
    backgroundColor: '#10B981',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  modalRegisterText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  // Role selection in approve modal
  roleSelectionContainer: {
    marginBottom: 20,
  },
  roleSelectionTitle: {
    color: '#9CA3AF',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 12,
  },
  roleOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#374151',
    borderRadius: 8,
    padding: 14,
    marginBottom: 8,
  },
  roleRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#6B7280',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  roleRadioSelected: {
    borderColor: '#2563EB',
  },
  roleRadioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#2563EB',
  },
  roleOptionText: {
    flex: 1,
  },
  roleOptionLabel: {
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: '600',
  },
  roleOptionDesc: {
    color: '#9CA3AF',
    fontSize: 12,
    marginTop: 2,
  },
  // Device styles
  registerDeviceButton: {
    backgroundColor: '#2563EB',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  registerDeviceButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  deviceCard: {
    backgroundColor: '#1F2937',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  deviceCardCurrent: {
    borderWidth: 2,
    borderColor: '#2563EB',
  },
  deviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  deviceName: {
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: '600',
  },
  currentDeviceBadge: {
    backgroundColor: '#2563EB',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
  },
  currentDeviceBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
  },
  deviceModel: {
    color: '#9CA3AF',
    fontSize: 13,
    marginBottom: 2,
  },
  deviceLastUser: {
    color: '#10B981',
    fontSize: 12,
    marginTop: 4,
  },
  expandIcon: {
    color: '#6B7280',
    fontSize: 12,
    marginLeft: 8,
  },
  deviceExpanded: {
    backgroundColor: '#111827',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#374151',
  },
  deviceIdText: {
    color: '#6B7280',
    fontSize: 11,
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  deviceRegisteredText: {
    color: '#6B7280',
    fontSize: 12,
    marginBottom: 16,
  },
  loginHistorySection: {
    marginBottom: 16,
  },
  loginHistoryTitle: {
    color: '#F9FAFB',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  noHistoryText: {
    color: '#6B7280',
    fontSize: 12,
    fontStyle: 'italic',
  },
  loginHistoryEntry: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  loginHistoryDriver: {
    color: '#E5E7EB',
    fontSize: 13,
  },
  loginHistoryTime: {
    color: '#6B7280',
    fontSize: 12,
  },
  moreHistoryText: {
    color: '#6B7280',
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 8,
  },
  removeDeviceButton: {
    backgroundColor: '#374151',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  removeDeviceText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '500',
  },
  // Performance tracker button
  performanceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E3A5F',
    marginHorizontal: 12,
    marginVertical: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2563EB',
  },
  performanceButtonIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  performanceButtonText: {
    flex: 1,
  },
  performanceButtonTitle: {
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: '600',
  },
  performanceButtonSubtitle: {
    color: '#9CA3AF',
    fontSize: 12,
    marginTop: 2,
  },
  performanceButtonArrow: {
    color: '#60A5FA',
    fontSize: 20,
    fontWeight: '600',
  },
  // Unified logs styles
  logFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  logFilterRow2: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  logSourceToggle: {
    flexDirection: 'row',
    backgroundColor: '#374151',
    borderRadius: 8,
    overflow: 'hidden',
    flex: 1,
  },
  logSourceBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
  },
  logSourceBtnActive: {
    backgroundColor: '#2563EB',
  },
  logSourceBtnText: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
  },
  logSourceBtnTextActive: {
    color: '#FFFFFF',
  },
  logDaysToggle: {
    flexDirection: 'row',
    backgroundColor: '#374151',
    borderRadius: 8,
    overflow: 'hidden',
  },
  logDaysBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  logDaysBtnActive: {
    backgroundColor: '#2563EB',
  },
  logDaysBtnText: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
  },
  logDaysBtnTextActive: {
    color: '#FFFFFF',
  },
  logLevelToggle: {
    flexDirection: 'row',
    backgroundColor: '#374151',
    borderRadius: 8,
    overflow: 'hidden',
    flex: 1,
  },
  logLevelBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
  },
  logLevelBtnActive: {
    backgroundColor: '#2563EB',
  },
  logLevelBtnActiveWarn: {
    backgroundColor: '#F59E0B',
  },
  logLevelBtnActiveError: {
    backgroundColor: '#EF4444',
  },
  logLevelBtnText: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
  },
  logLevelBtnTextActive: {
    color: '#FFFFFF',
  },
  logLevelBtnTextActiveWarn: {
    color: '#000000',
  },
  logLevelBtnTextActiveError: {
    color: '#FFFFFF',
  },
  debugBtn: {
    backgroundColor: '#374151',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  debugBtnText: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '500',
  },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E3A5F',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2563EB',
  },
  selectAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectAllCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#60A5FA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectAllCheckboxChecked: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  selectAllCheckboxPartial: {
    backgroundColor: '#1E40AF',
    borderColor: '#2563EB',
  },
  selectAllCheckmark: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  selectAllText: {
    color: '#60A5FA',
    fontSize: 14,
    fontWeight: '500',
  },
  selectionCount: {
    color: '#9CA3AF',
    fontSize: 13,
  },
  deleteIconBtn: {
    padding: 8,
  },
  deleteIconBtnDisabled: {
    opacity: 0.5,
  },
  logHint: {
    color: '#6B7280',
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 8,
    fontStyle: 'italic',
  },
  unifiedLogEntry: {
    backgroundColor: '#1F2937',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  unifiedLogEntryLocal: {
    borderLeftWidth: 3,
    borderLeftColor: '#6B7280',
  },
  unifiedLogEntrySystem: {
    borderLeftWidth: 3,
    borderLeftColor: '#2563EB',
  },
  unifiedLogEntrySelected: {
    backgroundColor: '#1E3A5F',
    borderColor: '#2563EB',
    borderWidth: 1,
  },
  logCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#6B7280',
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logCheckboxSelected: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  logCheckmark: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  logContent: {
    flex: 1,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  logHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logTypeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  logTypeBadgeLocal: {
    backgroundColor: '#374151',
  },
  logTypeBadgeSystem: {
    backgroundColor: '#1E3A5F',
  },
  logTypeBadgeText: {
    color: '#9CA3AF',
    fontSize: 9,
    fontWeight: '700',
  },
  sysLogEvent: {
    color: '#F9FAFB',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  sysLogDetails: {
    color: '#9CA3AF',
    fontSize: 12,
    marginBottom: 8,
  },
  sysLogMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#374151',
    paddingTop: 8,
    marginTop: 4,
  },
  sysLogDevice: {
    color: '#60A5FA',
    fontSize: 11,
  },
  sysLogDriver: {
    color: '#10B981',
    fontSize: 11,
  },
  // Production tab styles
  prodFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  prodDateGroup: {
    backgroundColor: '#1F2937',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  prodDateHeader: {
    color: '#60A5FA',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
    paddingBottom: 8,
  },
  prodHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 6,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  prodHeaderWell: {
    flex: 2,
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '600',
  },
  prodHeaderValue: {
    flex: 1,
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'right',
  },
  prodHeaderPulls: {
    width: 40,
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'right',
  },
  prodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  prodWellName: {
    flex: 2,
    color: '#F9FAFB',
    fontSize: 13,
    fontWeight: '500',
  },
  prodValue: {
    flex: 1,
    color: '#E5E7EB',
    fontSize: 13,
    textAlign: 'right',
    fontFamily: 'monospace',
  },
  prodDiffPositive: {
    color: '#F59E0B',
  },
  prodDiffNegative: {
    color: '#10B981',
  },
  prodPulls: {
    width: 40,
    color: '#9CA3AF',
    fontSize: 12,
    textAlign: 'right',
  },
});
