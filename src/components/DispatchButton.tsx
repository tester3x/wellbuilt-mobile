import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Dimensions,
  Animated,
  PanResponder,
  GestureResponderEvent,
  PanResponderGestureState,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDispatch } from '../contexts/DispatchContext';
import { isCompactModeEnabled } from '../services/dispatchMessage';
import { hp, spacing, wp } from '../ui/layout';

const STORAGE_KEY_MINIMIZED_POSITION = 'wellbuilt_dispatch_minimized_pos';

// Minimized pill dimensions
const PILL_WIDTH = 60;
const PILL_HEIGHT = 60;

// Long press duration to start drag
const LONG_PRESS_DURATION = 500;

// Double tap detection
const DOUBLE_TAP_DELAY = 300;

// Get current screen dimensions (for foldable devices)
const getScreenDimensions = () => Dimensions.get('window');

interface DispatchButtonProps {
  style?: object;
}

export function DispatchButton({ style }: DispatchButtonProps) {
  const {
    hasPendingSends,
    pendingCount,
    currentMessage,
    currentRecipient,
    generatedMessageText,
    sendNext,
    skipCurrent,
    cancelAll,
  } = useDispatch();

  // Use dynamic dimensions for foldable devices
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const [isMinimized, setIsMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [compactMode, setCompactMode] = useState(false);

  // Calculate default positions based on current screen size
  const defaultMinimizedX = screenWidth - PILL_WIDTH - 16;
  const defaultMinimizedY = screenHeight - PILL_HEIGHT - screenHeight * 0.14;
  const expandedBottom = screenHeight * 0.12;

  // Double tap tracking
  const lastTapTime = useRef(0);

  // Position for minimized pill (animated) - initialize to 0,0, will be set properly on load
  const minimizedPosition = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // Track actual position for bounds checking
  const positionRef = useRef({ x: 0, y: 0 });
  const hasInitializedPosition = useRef(false);

  // Long press timer
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canDrag = useRef(false);
  const isMinimizedRef = useRef(isMinimized);
  const compactModeRef = useRef(compactMode);

  // Refs for functions so PanResponder always has current versions
  const sendNextRef = useRef(sendNext);
  const skipCurrentRef = useRef(skipCurrent);

  // Keep refs in sync with state/functions
  useEffect(() => {
    isMinimizedRef.current = isMinimized;
  }, [isMinimized]);

  useEffect(() => {
    compactModeRef.current = compactMode;
  }, [compactMode]);

  useEffect(() => {
    sendNextRef.current = sendNext;
  }, [sendNext]);

  useEffect(() => {
    skipCurrentRef.current = skipCurrent;
  }, [skipCurrent]);

  // Track previous pending count to detect new queues
  const prevPendingCount = useRef(pendingCount);

  // Load compact mode setting on mount
  useEffect(() => {
    const loadCompactMode = async () => {
      const enabled = await isCompactModeEnabled();
      console.log('[DispatchButton] Compact mode:', enabled);
      setCompactMode(enabled);
    };
    loadCompactMode();
  }, []);

  // Reset isMinimized when a new send queue appears, based on mode
  useEffect(() => {
    // Detect when pending sends go from 0 to >0 (new queue started)
    const isNewQueue = prevPendingCount.current === 0 && pendingCount > 0;
    prevPendingCount.current = pendingCount;

    if (isNewQueue && hasPendingSends) {
      // Reload compact mode in case user changed it
      const checkModeAndSetMinimized = async () => {
        const enabled = await isCompactModeEnabled();
        console.log('[DispatchButton] New queue detected, compact mode:', enabled);
        setCompactMode(enabled);
        // In compact mode: start minimized (badge only)
        // In banner mode: start expanded (full banner)
        setIsMinimized(enabled);
      };
      checkModeAndSetMinimized();
    }
  }, [pendingCount, hasPendingSends]);

  // Refs for screen dimensions (for PanResponder)
  const screenDimensionsRef = useRef({ width: screenWidth, height: screenHeight });
  useEffect(() => {
    screenDimensionsRef.current = { width: screenWidth, height: screenHeight };
  }, [screenWidth, screenHeight]);

  // Load saved minimized position or set default
  useEffect(() => {
    const loadPosition = async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY_MINIMIZED_POSITION);
        if (saved) {
          const pos = JSON.parse(saved);
          // Clamp to current screen bounds
          const clampedX = Math.min(pos.x, screenWidth - PILL_WIDTH - 16);
          const clampedY = Math.min(pos.y, screenHeight - PILL_HEIGHT - 20);
          positionRef.current = { x: clampedX, y: clampedY };
          minimizedPosition.setValue({ x: clampedX, y: clampedY });
        } else if (!hasInitializedPosition.current) {
          // Set default position
          positionRef.current = { x: defaultMinimizedX, y: defaultMinimizedY };
          minimizedPosition.setValue({ x: defaultMinimizedX, y: defaultMinimizedY });
        }
        hasInitializedPosition.current = true;
      } catch (error) {
        console.error('[DispatchButton] Error loading position:', error);
        // Set default position on error
        positionRef.current = { x: defaultMinimizedX, y: defaultMinimizedY };
        minimizedPosition.setValue({ x: defaultMinimizedX, y: defaultMinimizedY });
      }
    };
    loadPosition();
  }, [screenWidth, screenHeight, defaultMinimizedX, defaultMinimizedY]);

  // Save minimized position
  const savePosition = useCallback(async (x: number, y: number) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY_MINIMIZED_POSITION, JSON.stringify({ x, y }));
    } catch (error) {
      console.error('[DispatchButton] Error saving position:', error);
    }
  }, []);

  // Pan responder handlers as callbacks so they use current state via refs
  const handleGrant = useCallback(() => {
    // Start long press timer
    longPressTimer.current = setTimeout(() => {
      canDrag.current = true;
      setIsDragging(true);
    }, LONG_PRESS_DURATION);

    // Set offset to current position
    minimizedPosition.setOffset({
      x: positionRef.current.x,
      y: positionRef.current.y,
    });
    minimizedPosition.setValue({ x: 0, y: 0 });
  }, [minimizedPosition]);

  const handleMove = useCallback((_: GestureResponderEvent, gestureState: PanResponderGestureState) => {
    if (canDrag.current) {
      const { width, height } = screenDimensionsRef.current;
      // Calculate new position with bounds
      const newX = Math.max(0, Math.min(
        width - PILL_WIDTH,
        positionRef.current.x + gestureState.dx
      ));
      const newY = Math.max(height * 0.1, Math.min(
        height - PILL_HEIGHT - 20,
        positionRef.current.y + gestureState.dy
      ));

      minimizedPosition.setValue({
        x: newX - positionRef.current.x,
        y: newY - positionRef.current.y,
      });
    }
  }, [minimizedPosition]);

  const handleRelease = useCallback((_: GestureResponderEvent, gestureState: PanResponderGestureState) => {
    // Clear long press timer
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    if (canDrag.current) {
      const { width, height } = screenDimensionsRef.current;
      // Finalize position
      minimizedPosition.flattenOffset();

      // Calculate final position
      const finalX = Math.max(0, Math.min(
        width - PILL_WIDTH,
        positionRef.current.x + gestureState.dx
      ));
      const finalY = Math.max(height * 0.1, Math.min(
        height - PILL_HEIGHT - 20,
        positionRef.current.y + gestureState.dy
      ));

      positionRef.current = { x: finalX, y: finalY };
      minimizedPosition.setValue({ x: finalX, y: finalY });
      savePosition(finalX, finalY);

      canDrag.current = false;
      setIsDragging(false);
    } else {
      // It was a tap, not a drag
      minimizedPosition.flattenOffset();
      minimizedPosition.setValue(positionRef.current);

      const now = Date.now();
      const timeSinceLastTap = now - lastTapTime.current;

      if (timeSinceLastTap < DOUBLE_TAP_DELAY) {
        // Double tap detected
        lastTapTime.current = 0; // Reset to prevent triple-tap
        if (compactModeRef.current) {
          // Double tap in button mode - skip current
          skipCurrentRef.current();
        } else {
          // Double tap in banner mode - expand to banner
          setIsMinimized(false);
        }
      } else {
        // Single tap - send the message
        lastTapTime.current = now;
        // Use setTimeout to wait for potential second tap
        setTimeout(() => {
          // Only send if this was truly a single tap (no second tap came)
          if (lastTapTime.current === now) {
            sendNextRef.current();
          }
        }, DOUBLE_TAP_DELAY);
      }
    }
  }, [minimizedPosition, savePosition]);

  const handleTerminate = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    canDrag.current = false;
    setIsDragging(false);
    minimizedPosition.flattenOffset();
    minimizedPosition.setValue(positionRef.current);
  }, [minimizedPosition]);

  // Pan responder for drag when minimized
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => isMinimizedRef.current,
      onMoveShouldSetPanResponder: () => isMinimizedRef.current && canDrag.current,
      onPanResponderGrant: handleGrant,
      onPanResponderMove: handleMove,
      onPanResponderRelease: handleRelease,
      onPanResponderTerminate: handleTerminate,
    })
  ).current;

  // Debug logging
  console.log('[DispatchButton] State:', {
    hasPendingSends,
    pendingCount,
    currentMessage: currentMessage?.wellName,
    currentRecipient: currentRecipient?.name,
    isMinimized,
    compactMode,
  });

  if (!hasPendingSends || !currentRecipient || !currentMessage) {
    console.log('[DispatchButton] Not rendering - no pending sends, recipient, or message');
    return null;
  }

  const channelIcon = currentRecipient.channel === 'sms' ? '💬' : '📱';
  const channelLabel = currentRecipient.channel === 'sms' ? 'SMS' : 'WhatsApp';

  // Format level for display
  // Always floor - matches packet level sent to VBA for consistent display
  const formatLevel = (feet: number): string => {
    // Add small epsilon to handle floating point precision (e.g., 23.9999... → 24)
    const totalInches = Math.floor(feet * 12 + 0.0001);
    const wholeFeet = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    return inches > 0 ? `${wholeFeet}'${inches}"` : `${wholeFeet}'`;
  };

  // Build message details string
  const messageDetails = `${currentMessage.wellName}: ${formatLevel(currentMessage.topLevel)} → ${formatLevel(currentMessage.bottomLevel)}, ${currentMessage.bbls} bbls`;
  const editLabel = currentMessage.isEdit ? ' (EDIT)' : '';

  // Get abbreviated well name for badge (first 6 chars or less)
  const wellAbbrev = currentMessage.wellName.length > 6
    ? currentMessage.wellName.substring(0, 6)
    : currentMessage.wellName;

  // Minimized pill view
  if (isMinimized) {
    return (
      <Animated.View
        style={[
          styles.minimizedContainer,
          {
            transform: [
              { translateX: minimizedPosition.x },
              { translateY: minimizedPosition.y },
            ],
          },
          isDragging && styles.dragging,
        ]}
        {...panResponder.panHandlers}
      >
        <View style={[styles.minimizedPill, isDragging && styles.minimizedPillDragging]}>
          <Text style={styles.minimizedIcon}>{channelIcon}</Text>
          <Text style={styles.minimizedWellName} numberOfLines={1}>{wellAbbrev}</Text>
          <View style={styles.minimizedBadge}>
            <Text style={styles.minimizedBadgeText}>{pendingCount}</Text>
          </View>
        </View>
      </Animated.View>
    );
  }

  // Expanded banner view
  // Layout: 3/4 left (info + hint), 1/4 right (buttons centered)
  return (
    <View style={[styles.container, { bottom: expandedBottom }, style]}>
      <TouchableOpacity
        style={styles.banner}
        onPress={() => setIsMinimized(true)}
        activeOpacity={0.9}
      >
        <View style={styles.mainRow}>
          {/* Left 3/4: Info top, hint bottom centered */}
          <View style={styles.leftSection}>
            <Text style={styles.title}>
              {channelIcon} Send to {currentRecipient.name}{editLabel}
            </Text>
            <Text style={styles.messageDetails} numberOfLines={2}>
              {messageDetails}
            </Text>
            <Text style={styles.subtitle}>
              {pendingCount} message{pendingCount > 1 ? 's' : ''} queued • Tap to minimize
            </Text>
          </View>

          {/* Right 1/4: Buttons centered */}
          <View style={styles.buttonSection}>
            <TouchableOpacity style={styles.sendButton} onPress={sendNext}>
              <Text style={styles.sendButtonText}>Send</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.skipButton} onPress={skipCurrent}>
              <Text style={styles.skipButtonText}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>

      {/* Cancel all option */}
      <TouchableOpacity style={styles.cancelButton} onPress={cancelAll}>
        <Text style={styles.cancelButtonText}>Cancel All</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    // bottom is set dynamically via inline style
    left: wp('4%'),
    right: wp('4%'),
    zIndex: 100,
  },
  banner: {
    backgroundColor: '#1F2937',
    borderRadius: hp('1.2%'),
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#2563EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  mainRow: {
    flexDirection: 'row',
  },
  leftSection: {
    flex: 1, // Take remaining space
    justifyContent: 'center',
  },
  title: {
    fontSize: hp('1.8%'),
    fontWeight: '600',
    color: '#F9FAFB',
  },
  messageDetails: {
    fontSize: hp('1.6%'),
    color: '#60A5FA', // Blue to stand out
    fontWeight: '500',
    marginTop: 4,
    lineHeight: hp('2.2%'),
  },
  subtitle: {
    fontSize: hp('1.3%'),
    color: '#6B7280',
    marginTop: spacing.sm,
  },
  buttonSection: {
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    marginLeft: spacing.sm,
  },
  skipButton: {
    paddingVertical: spacing.sm,
    borderRadius: hp('0.6%'),
    backgroundColor: '#374151',
    width: 72,
    alignItems: 'center',
  },
  skipButtonText: {
    fontSize: hp('1.6%'),
    color: '#9CA3AF',
    fontWeight: '500',
  },
  sendButton: {
    paddingVertical: spacing.sm,
    borderRadius: hp('0.6%'),
    backgroundColor: '#2563EB',
    width: 72,
    alignItems: 'center',
  },
  sendButtonText: {
    fontSize: hp('1.6%'),
    color: '#FFFFFF',
    fontWeight: '600',
  },
  cancelButton: {
    alignSelf: 'center',
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
  },
  cancelButtonText: {
    fontSize: hp('1.3%'),
    color: '#6B7280',
  },
  // Minimized styles
  minimizedContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 100,
  },
  minimizedPill: {
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    borderRadius: PILL_WIDTH / 2,
    backgroundColor: '#1F2937',
    borderWidth: 2,
    borderColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  minimizedIcon: {
    fontSize: 24,
  },
  minimizedWellName: {
    fontSize: 9,
    fontWeight: '600',
    color: '#9CA3AF',
    position: 'absolute',
    bottom: 2,
    textAlign: 'center',
  },
  minimizedBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#DC2626',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  minimizedBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  dragging: {
    opacity: 0.8,
  },
  minimizedPillDragging: {
    transform: [{ scale: 1.1 }],
  },
});
