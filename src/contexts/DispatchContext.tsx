import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DispatchRecipient,
  PullMessageData,
  QueuedMessage,
  isDispatchReady,
  createSendQueue,
  sendToRecipient,
  loadRecipients,
  getEnabledRecipients,
  loadMessageQueue,
  removeFirstFromQueue,
  clearMessageQueue,
  getMessageQueueCount,
  getFirstQueuedMessage,
  generateMessageFromQueue,
  formatLevelForMessage,
} from '../services/dispatchMessage';

// Storage key for persisting recipient index across app backgrounding
const STORAGE_KEY_RECIPIENT_INDEX = 'wellbuilt_dispatch_recipient_index';

interface DispatchContextType {
  // State
  hasPendingSends: boolean;
  pendingCount: number;
  currentMessage: QueuedMessage | null; // The queued message with pull details
  currentRecipient: DispatchRecipient | null; // Current recipient to send to
  generatedMessageText: string; // The actual text that will be sent

  // Actions
  initiateSendQueue: (data: PullMessageData) => Promise<boolean>;
  sendNext: () => Promise<void>;
  skipCurrent: () => Promise<void>;
  cancelAll: () => Promise<void>;
  refresh: () => Promise<void>;
}

const DispatchContext = createContext<DispatchContextType | null>(null);

export function useDispatch() {
  const context = useContext(DispatchContext);
  if (!context) {
    throw new Error('useDispatch must be used within a DispatchProvider');
  }
  return context;
}

export function DispatchProvider({ children }: { children: React.ReactNode }) {
  const [hasPendingSends, setHasPendingSends] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [currentMessage, setCurrentMessage] = useState<QueuedMessage | null>(null);
  const [currentRecipient, setCurrentRecipient] = useState<DispatchRecipient | null>(null);
  const [generatedMessageText, setGeneratedMessageText] = useState('');

  // Track which recipient index we're on for the current message
  // This lets us send to ALL recipients before moving to next message
  const recipientIndexRef = useRef(0);
  const allRecipientsRef = useRef<DispatchRecipient[]>([]);

  // Load current state from the new message queue
  const loadCurrentState = useCallback(async (resetRecipientIndex: boolean = true) => {
    const messageCount = await getMessageQueueCount();
    const recipients = await getEnabledRecipients();

    // Load persisted recipient index (survives app backgrounding)
    if (!resetRecipientIndex) {
      try {
        const savedIndex = await AsyncStorage.getItem(STORAGE_KEY_RECIPIENT_INDEX);
        if (savedIndex !== null) {
          recipientIndexRef.current = parseInt(savedIndex, 10);
          console.log('[DispatchContext] Loaded persisted recipient index:', recipientIndexRef.current);
        }
      } catch (error) {
        console.error('[DispatchContext] Error loading recipient index:', error);
      }
    } else {
      // Reset and clear persisted index
      recipientIndexRef.current = 0;
      try {
        await AsyncStorage.removeItem(STORAGE_KEY_RECIPIENT_INDEX);
      } catch (error) {
        console.error('[DispatchContext] Error clearing recipient index:', error);
      }
    }

    // Calculate total remaining sends:
    // For current message: remaining recipients (total - current index)
    // For other messages: all recipients each
    let totalSends = 0;
    if (messageCount > 0) {
      // First message: remaining recipients from current index
      const remainingForCurrentMsg = recipients.length - recipientIndexRef.current;
      // Other messages: all recipients each
      const sendsForOtherMsgs = (messageCount - 1) * recipients.length;
      totalSends = remainingForCurrentMsg + sendsForOtherMsgs;
    }

    console.log('[DispatchContext] loadCurrentState - messages:', messageCount, 'recipients:', recipients.length, 'recipientIndex:', recipientIndexRef.current, 'totalSends:', totalSends, 'resetRecipientIndex:', resetRecipientIndex);
    setPendingCount(totalSends);
    setHasPendingSends(totalSends > 0);

    if (messageCount > 0 && recipients.length > 0) {
      // Get the first queued message
      const firstMsg = await getFirstQueuedMessage();
      console.log('[DispatchContext] First queued message:', firstMsg?.wellName, firstMsg?.isEdit ? '(EDIT)' : '');

      if (firstMsg) {
        setCurrentMessage(firstMsg);
        allRecipientsRef.current = recipients;

        if (recipientIndexRef.current < recipients.length) {
          const recipient = recipients[recipientIndexRef.current];
          setCurrentRecipient(recipient);
          console.log('[DispatchContext] Current recipient:', recipient.name, `(${recipientIndexRef.current + 1}/${recipients.length})`);

          // Generate the message text at display time (time placeholder = now)
          const messageText = await generateMessageFromQueue(firstMsg, recipient);
          setGeneratedMessageText(messageText);
        } else {
          // All recipients done for this message - move to next message
          console.log('[DispatchContext] All recipients done for this message, advancing to next');
          await removeFirstFromQueue();
          recipientIndexRef.current = 0;
          await AsyncStorage.removeItem(STORAGE_KEY_RECIPIENT_INDEX);
          // Recursive call to load next message
          await loadCurrentState(true);
          return;
        }
      } else {
        setCurrentMessage(null);
        setCurrentRecipient(null);
        setGeneratedMessageText('');
      }
    } else {
      setCurrentMessage(null);
      setCurrentRecipient(null);
      setGeneratedMessageText('');
      recipientIndexRef.current = 0;
      allRecipientsRef.current = [];
      try {
        await AsyncStorage.removeItem(STORAGE_KEY_RECIPIENT_INDEX);
      } catch (error) {
        console.error('[DispatchContext] Error clearing recipient index:', error);
      }
    }
  }, []);

  // Load state on mount
  useEffect(() => {
    loadCurrentState();
  }, [loadCurrentState]);

  // Refresh state when app comes to foreground (user returned from SMS/WhatsApp)
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        // Small delay to let user see the app before we update
        // CRITICAL: Pass false to NOT reset recipient index when returning from SMS/WhatsApp
        // Without this, the app always resets to the first recipient after each send
        setTimeout(() => loadCurrentState(false), 500);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [loadCurrentState]);

  // Initiate send queue after a pull - adds to queue (stacks)
  const initiateSendQueue = useCallback(async (data: PullMessageData): Promise<boolean> => {
    const ready = await isDispatchReady();
    if (!ready) {
      console.log('[DispatchContext] Dispatch not ready (disabled or missing config)');
      return false;
    }

    const queuedMsg = await createSendQueue(data);
    if (!queuedMsg) {
      console.log('[DispatchContext] Failed to add to queue');
      return false;
    }

    console.log('[DispatchContext] Added to queue:', queuedMsg.wellName, queuedMsg.isEdit ? '(EDIT)' : '');
    await loadCurrentState();
    return true;
  }, [loadCurrentState]);

  // Send to current recipient, then advance to next recipient or next message
  const sendNext = useCallback(async () => {
    if (!currentRecipient || !currentMessage) return;

    // Generate message with CURRENT time for {time} placeholder
    const messageText = await generateMessageFromQueue(currentMessage, currentRecipient);
    console.log('[DispatchContext] Sending to', currentRecipient.name, 'via', currentRecipient.channel,
      `(${recipientIndexRef.current + 1}/${allRecipientsRef.current.length})`);
    console.log('[DispatchContext] Message:', messageText.substring(0, 50) + '...');

    // CRITICAL: Increment and persist the recipient index BEFORE opening SMS app
    // This ensures when user returns, we don't show the same message again
    const nextIndex = recipientIndexRef.current + 1;
    recipientIndexRef.current = nextIndex;

    if (nextIndex < allRecipientsRef.current.length) {
      // More recipients - persist the new index
      await AsyncStorage.setItem(STORAGE_KEY_RECIPIENT_INDEX, nextIndex.toString());
      console.log('[DispatchContext] Persisted recipient index:', nextIndex);
    } else {
      // All recipients done for this message - remove from queue and clear index
      console.log('[DispatchContext] All recipients done, removing message from queue');
      await removeFirstFromQueue();
      recipientIndexRef.current = 0;
      await AsyncStorage.removeItem(STORAGE_KEY_RECIPIENT_INDEX);
    }

    // Open SMS/WhatsApp app (this backgrounds the app)
    await sendToRecipient(currentRecipient, messageText);

    // Note: Code after this point may not run reliably because the app is backgrounded
    // The loadCurrentState on app foreground will handle updating the UI
  }, [currentRecipient, currentMessage]);

  // Skip current recipient (move to next recipient, or next message if no more recipients)
  const skipCurrent = useCallback(async () => {
    console.log('[DispatchContext] Skipping current recipient:', currentRecipient?.name, 'for message:', currentMessage?.wellName);

    // Move to next recipient
    const nextIndex = recipientIndexRef.current + 1;
    recipientIndexRef.current = nextIndex;

    if (nextIndex < allRecipientsRef.current.length) {
      // More recipients - persist index and update state
      await AsyncStorage.setItem(STORAGE_KEY_RECIPIENT_INDEX, nextIndex.toString());
      console.log('[DispatchContext] Moving to next recipient:', nextIndex + 1, 'of', allRecipientsRef.current.length);
      await loadCurrentState(false);
    } else {
      // No more recipients - move to next message
      console.log('[DispatchContext] No more recipients, moving to next message');
      await removeFirstFromQueue();
      recipientIndexRef.current = 0;
      await AsyncStorage.removeItem(STORAGE_KEY_RECIPIENT_INDEX);
      await loadCurrentState(true);
    }
  }, [currentMessage, currentRecipient, loadCurrentState]);

  // Cancel all pending messages
  const cancelAll = useCallback(async () => {
    console.log('[DispatchContext] Cancelling all messages');
    await clearMessageQueue();
    await AsyncStorage.removeItem(STORAGE_KEY_RECIPIENT_INDEX);
    await loadCurrentState(true);
  }, [loadCurrentState]);

  // Manual refresh
  const refresh = useCallback(async () => {
    await loadCurrentState();
  }, [loadCurrentState]);

  return (
    <DispatchContext.Provider
      value={{
        hasPendingSends,
        pendingCount,
        currentMessage,
        currentRecipient,
        generatedMessageText,
        initiateSendQueue,
        sendNext,
        skipCurrent,
        cancelAll,
        refresh,
      }}
    >
      {children}
    </DispatchContext.Provider>
  );
}
