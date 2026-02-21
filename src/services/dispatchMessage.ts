import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions, Linking, Platform } from 'react-native';
import * as SMS from 'expo-sms';
import * as Clipboard from 'expo-clipboard';
import { debugLog } from './debugLog';

// Helper to detect if device is likely a tablet (screen width > 600dp)
function isTablet(): boolean {
  const { width, height } = Dimensions.get('window');
  const minDimension = Math.min(width, height);
  return minDimension >= 600;
}

// Storage keys
const STORAGE_KEY_RECIPIENTS = 'wellbuilt_dispatch_recipients';
const STORAGE_KEY_MESSAGE_TEMPLATE = 'wellbuilt_dispatch_template';
const STORAGE_KEY_PENDING_SENDS = 'wellbuilt_pending_sends';
const STORAGE_KEY_DISPATCH_ENABLED = 'wellbuilt_dispatch_enabled';
const STORAGE_KEY_COMPACT_MODE = 'wellbuilt_dispatch_compact_mode';

// Recipient types
export type DispatchChannel = 'sms' | 'whatsapp';

export interface DispatchRecipient {
  id: string;
  name: string; // Display name (e.g., "Dispatch", "Office")
  phone: string; // Phone number
  channel: DispatchChannel;
  enabled: boolean;
  customTemplate?: MessageTemplate; // Optional per-recipient template override
}

// Message template with field positions
export interface MessageFieldPosition {
  field: 'well' | 'top' | 'bottom' | 'time' | 'bbls';
  start: number; // Character position in template
  end: number;
}

export interface MessageTemplate {
  template: string; // The raw template text with placeholders
  fields: MessageFieldPosition[];
}

// Pull data for message generation
export interface PullMessageData {
  wellName: string;
  topLevel: number; // feet
  bottomLevel: number; // feet (calculated: top - bbls/20)
  time: Date;
  bbls: number;
  isEdit?: boolean; // true if this is an edit of an existing pull
}

// Queued message - one per pull (not per recipient)
// Contains template data that gets filled at send time
export interface QueuedMessage {
  id: string; // Unique ID for this queued message
  wellName: string;
  topLevel: number;
  bottomLevel: number;
  recordedTime: Date; // When the pull was recorded
  bbls: number;
  isEdit: boolean;
  queuedAt: number; // When this was added to queue
}

// Pending send queue item (legacy - now derived from QueuedMessage + recipient)
export interface PendingSend {
  recipientId: string;
  message: string;
  timestamp: number;
}

// Storage key for the new message queue
const STORAGE_KEY_MESSAGE_QUEUE = 'wellbuilt_dispatch_message_queue';

// Format feet as "X'Y\"" or "X Y" style
// Uses floor to show exact level without rounding up
export function formatLevelForMessage(feet: number, useQuotes: boolean = false): string {
  const totalInches = Math.floor(feet * 12);
  const wholeFeet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;

  if (useQuotes) {
    return inches > 0 ? `${wholeFeet}'${inches}"` : `${wholeFeet}'`;
  } else {
    // Space-separated format like "10 3" for 10'3"
    return `${wholeFeet} ${inches}`;
  }
}

// Format time for message (e.g., "3:23am" or "12:05pm")
export function formatTimeForMessage(date: Date): string {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';

  hours = hours % 12;
  if (hours === 0) hours = 12;

  const minuteStr = minutes.toString().padStart(2, '0');
  return `${hours}:${minuteStr}${ampm}`;
}

// Format time in 24-hour format (e.g., "15:23" or "03:05")
export function formatTime24ForMessage(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

// Load recipients from storage
export async function loadRecipients(): Promise<DispatchRecipient[]> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY_RECIPIENTS);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.error('[DispatchMessage] Error loading recipients:', error);
  }
  return [];
}

// Save recipients to storage
export async function saveRecipients(recipients: DispatchRecipient[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_RECIPIENTS, JSON.stringify(recipients));
  } catch (error) {
    console.error('[DispatchMessage] Error saving recipients:', error);
  }
}

// Add a new recipient
export async function addRecipient(recipient: Omit<DispatchRecipient, 'id'>): Promise<DispatchRecipient> {
  const recipients = await loadRecipients();
  const newRecipient: DispatchRecipient = {
    ...recipient,
    id: Date.now().toString(),
  };
  recipients.push(newRecipient);
  await saveRecipients(recipients);
  return newRecipient;
}

// Update a recipient
export async function updateRecipient(id: string, updates: Partial<DispatchRecipient>): Promise<void> {
  const recipients = await loadRecipients();
  const index = recipients.findIndex(r => r.id === id);
  if (index >= 0) {
    recipients[index] = { ...recipients[index], ...updates };
    await saveRecipients(recipients);
  }
}

// Delete a recipient
export async function deleteRecipient(id: string): Promise<void> {
  const recipients = await loadRecipients();
  const filtered = recipients.filter(r => r.id !== id);
  await saveRecipients(filtered);
}

// Default message template - used if user hasn't customized
export const DEFAULT_MESSAGE_TEMPLATE: MessageTemplate = {
  template: '{well}\n{top}\n{bottom}          {time}',
  fields: [],
};

// Load message template (returns default if none saved)
export async function loadMessageTemplate(): Promise<MessageTemplate | null> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY_MESSAGE_TEMPLATE);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.error('[DispatchMessage] Error loading template:', error);
  }
  // Return default template instead of null
  return DEFAULT_MESSAGE_TEMPLATE;
}

// Save message template
export async function saveMessageTemplate(template: MessageTemplate): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_MESSAGE_TEMPLATE, JSON.stringify(template));
  } catch (error) {
    console.error('[DispatchMessage] Error saving template:', error);
  }
}

// Generate message from template and pull data
// sendTime is optional - if not provided, uses current time (for {time} placeholder)
export function generateMessage(template: MessageTemplate, data: PullMessageData, sendTime?: Date): string {
  let message = template.template;

  // Use current time for {time} placeholder if sendTime not specified
  // This ensures the time in the message is when you tap Send, not when you recorded
  const timeForMessage = sendTime || new Date();

  // Simple string replacement of placeholders (case-insensitive)
  // This is more reliable than position-based replacement
  message = message.replace(/\{well\}/gi, data.wellName);
  message = message.replace(/\{top\}/gi, formatLevelForMessage(data.topLevel, true));
  message = message.replace(/\{bottom\}/gi, formatLevelForMessage(data.bottomLevel, true));
  message = message.replace(/\{time\}/gi, formatTimeForMessage(timeForMessage));
  message = message.replace(/\{time24\}/gi, formatTime24ForMessage(timeForMessage));
  message = message.replace(/\{bbls\}/gi, `${data.bbls} bbls`);

  return message;
}

// Generate message from queued message data (fills template at send time with current time)
export async function generateMessageFromQueue(queuedMsg: QueuedMessage, recipient?: DispatchRecipient): Promise<string> {
  const globalTemplate = await loadMessageTemplate();
  const template = recipient?.customTemplate || globalTemplate;

  if (!template) {
    return `${queuedMsg.wellName}: ${formatLevelForMessage(queuedMsg.topLevel, true)} → ${formatLevelForMessage(queuedMsg.bottomLevel, true)}, ${queuedMsg.bbls} bbls`;
  }

  const data: PullMessageData = {
    wellName: queuedMsg.wellName,
    topLevel: queuedMsg.topLevel,
    bottomLevel: queuedMsg.bottomLevel,
    time: new Date(queuedMsg.recordedTime), // Not used for {time} placeholder
    bbls: queuedMsg.bbls,
    isEdit: queuedMsg.isEdit,
  };

  // Pass current time for {time} placeholder - this is when you tap Send
  return generateMessage(template, data, new Date());
}

// Get enabled recipients
export async function getEnabledRecipients(): Promise<DispatchRecipient[]> {
  const recipients = await loadRecipients();
  return recipients.filter(r => r.enabled);
}

// Open SMS app with pre-filled message
export async function openSMS(phone: string, message: string): Promise<boolean> {
  try {
    // Clean phone number (remove non-digits except +)
    const cleanPhone = phone.replace(/[^\d+]/g, '');
    const tablet = isTablet();

    debugLog(`openSMS called - Phone: ${cleanPhone}`);
    debugLog(`Message length: ${message.length}`);
    debugLog(`Message: ${message.substring(0, 80)}...`);
    debugLog(`Device type: ${tablet ? 'TABLET' : 'PHONE'}`);

    // For tablets, skip expo-sms entirely and go straight to Linking
    // expo-sms often fails on Android tablets ("No messaging application available")
    // even when the device has Samsung Messages or Google Messages installed
    if (Platform.OS === 'android' && tablet) {
      debugLog('Tablet detected - skipping expo-sms, using Linking API directly');
      return await openSMSViaLinking(cleanPhone, message, tablet);
    }

    // Try expo-sms for phones (works great on Z Fold and other phones)
    const isAvailable = await SMS.isAvailableAsync();
    debugLog(`expo-sms available: ${isAvailable}`);

    if (isAvailable) {
      debugLog('Using expo-sms native API with sendSMSAsync');
      try {
        const { result } = await SMS.sendSMSAsync([cleanPhone], message);
        // result can be: 'sent', 'cancelled', or 'unknown'
        debugLog(`SMS.sendSMSAsync result: ${result}`);
        return result !== 'cancelled';
      } catch (smsError) {
        debugLog(`expo-sms sendSMSAsync error: ${smsError}`, 'error');
        // Fall through to Linking fallback
      }
    }

    // Fallback to Linking API
    debugLog('Falling back to Linking API');
    return await openSMSViaLinking(cleanPhone, message, tablet);
  } catch (error) {
    console.error('[DispatchMessage] Error opening SMS:', error);
    debugLog(`openSMS error: ${error}`, 'error');
    return false;
  }
}

// Helper function to open SMS via Linking API
async function openSMSViaLinking(cleanPhone: string, message: string, tablet: boolean): Promise<boolean> {
  const encodedMessage = encodeURIComponent(message);

  if (Platform.OS === 'ios') {
    // iOS uses sms: with & separator
    const url = `sms:${cleanPhone}&body=${encodedMessage}`;
    debugLog(`iOS SMS URL: ${url.substring(0, 70)}...`);
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
      return true;
    }
    debugLog('iOS: Cannot open sms: URL', 'error');
    return false;
  }

  // Android - Samsung tablets specifically need a different approach
  // The key is to use the correct URI format that Samsung Messages understands

  if (tablet) {
    debugLog('Tablet: Trying specialized Samsung Messages formats');

    // For Samsung tablets, the most reliable format is:
    // smsto:<phone> with the body in a separate parameter
    // BUT Samsung Messages is picky about encoding

    // Always copy message to clipboard first as a fallback
    // This way if the URL body doesn't work, user can paste manually
    try {
      await Clipboard.setStringAsync(message);
      debugLog('Message copied to clipboard as fallback');
    } catch (clipboardError) {
      debugLog(`Failed to copy to clipboard: ${clipboardError}`, 'warn');
    }

    // Try these formats in order of likely success on Samsung tablets:
    const urlFormats = [
      // Format 1: smsto with body (most common Samsung format)
      // Note: Using encodeURIComponent but replacing %20 with + for spaces
      `smsto:${cleanPhone}?body=${encodedMessage.replace(/%20/g, '+')}`,
      // Format 2: smsto with body, standard encoding
      `smsto:${cleanPhone}?body=${encodedMessage}`,
      // Format 3: sms with body (Google Messages format)
      `sms:${cleanPhone}?body=${encodedMessage}`,
      // Format 4: smsto with sms_body (alternative parameter name)
      `smsto:${cleanPhone}?sms_body=${encodedMessage}`,
      // Format 5: Plain smsto without body (at least opens to the contact)
      // If we get here, at least the message is in clipboard for pasting
      `smsto:${cleanPhone}`,
    ];

    for (let i = 0; i < urlFormats.length; i++) {
      const url = urlFormats[i];
      debugLog(`Tablet format ${i + 1}/${urlFormats.length}: ${url.substring(0, 80)}...`);

      try {
        const canOpen = await Linking.canOpenURL(url);
        debugLog(`  canOpenURL: ${canOpen}`);

        if (canOpen) {
          await Linking.openURL(url);
          debugLog(`Tablet format ${i + 1} opened successfully`);

          // For the plain smsto format (no body), user will need to paste from clipboard
          if (i === urlFormats.length - 1) {
            debugLog('Opened SMS to contact - message is in clipboard, long-press to paste');
          }

          return true;
        }
      } catch (e) {
        debugLog(`Tablet format ${i + 1} failed: ${e}`, 'warn');
      }
    }

    debugLog('All tablet Linking formats failed', 'error');
    return false;
  }

  // Regular Android phone fallback
  // Format 1: smsto: with body parameter (works on most Samsung devices)
  const smstoUrl = `smsto:${cleanPhone}?body=${encodedMessage}`;

  // Format 2: sms: with ? separator
  const smsUrl = `sms:${cleanPhone}?body=${encodedMessage}`;

  // Try smsto first (better Samsung support)
  try {
    debugLog(`Trying smsto: ${smstoUrl.substring(0, 70)}...`);
    const canOpenSmsto = await Linking.canOpenURL('smsto:');
    if (canOpenSmsto) {
      await Linking.openURL(smstoUrl);
      return true;
    }
  } catch (e) {
    console.log('[DispatchMessage] smsto: not available, trying sms:');
  }

  // Fallback to sms:
  debugLog(`Trying sms: ${smsUrl.substring(0, 70)}...`);
  const canOpen = await Linking.canOpenURL(smsUrl);
  if (canOpen) {
    await Linking.openURL(smsUrl);
    return true;
  }

  console.error('[DispatchMessage] Cannot open any SMS URL format');
  return false;
}

// Open WhatsApp with pre-filled message
export async function openWhatsApp(phone: string, message: string): Promise<boolean> {
  try {
    // Clean phone number - WhatsApp needs country code without +
    let cleanPhone = phone.replace(/[^\d]/g, '');

    // If US number without country code, add 1
    if (cleanPhone.length === 10) {
      cleanPhone = '1' + cleanPhone;
    }

    debugLog(`openWhatsApp called - Phone: ${cleanPhone}`);
    debugLog(`Message length: ${message.length}`);

    const encodedMessage = encodeURIComponent(message);

    // iOS and Android have slightly different URL formats
    // Try the universal link first (wa.me), then fall back to app URL
    if (Platform.OS === 'ios') {
      // iOS: Use wa.me universal link which works more reliably
      const waUrl = `https://wa.me/${cleanPhone}?text=${encodedMessage}`;
      debugLog(`iOS WhatsApp URL: ${waUrl.substring(0, 60)}...`);

      try {
        const canOpen = await Linking.canOpenURL(waUrl);
        debugLog(`iOS canOpenURL(wa.me): ${canOpen}`);

        if (canOpen) {
          await Linking.openURL(waUrl);
          debugLog('iOS WhatsApp opened via wa.me');
          return true;
        }
      } catch (e) {
        debugLog(`iOS wa.me error: ${e}`, 'warn');
      }

      // Fallback to whatsapp:// scheme
      const appUrl = `whatsapp://send?phone=${cleanPhone}&text=${encodedMessage}`;
      debugLog(`iOS trying whatsapp:// scheme`);

      try {
        const canOpenApp = await Linking.canOpenURL('whatsapp://');
        debugLog(`iOS canOpenURL(whatsapp://): ${canOpenApp}`);

        if (canOpenApp) {
          await Linking.openURL(appUrl);
          debugLog('iOS WhatsApp opened via whatsapp://');
          return true;
        }
      } catch (e) {
        debugLog(`iOS whatsapp:// error: ${e}`, 'error');
      }

      debugLog('iOS: Could not open WhatsApp', 'error');
      return false;
    }

    // Android: Use whatsapp:// scheme
    const url = `whatsapp://send?phone=${cleanPhone}&text=${encodedMessage}`;
    debugLog(`Android WhatsApp URL: ${url.substring(0, 60)}...`);

    const canOpen = await Linking.canOpenURL(url);
    debugLog(`Android canOpenURL: ${canOpen}`);

    if (canOpen) {
      await Linking.openURL(url);
      debugLog('Android WhatsApp opened');
      return true;
    } else {
      // Try web fallback
      const webUrl = `https://wa.me/${cleanPhone}?text=${encodedMessage}`;
      debugLog(`Android trying web fallback: ${webUrl.substring(0, 60)}...`);
      await Linking.openURL(webUrl);
      return true;
    }
  } catch (error) {
    console.error('[DispatchMessage] Error opening WhatsApp:', error);
    debugLog(`openWhatsApp error: ${error}`, 'error');
    return false;
  }
}

// Send message to a recipient (opens the appropriate app)
export async function sendToRecipient(recipient: DispatchRecipient, message: string): Promise<boolean> {
  if (recipient.channel === 'sms') {
    return openSMS(recipient.phone, message);
  } else if (recipient.channel === 'whatsapp') {
    return openWhatsApp(recipient.phone, message);
  }
  return false;
}

// Save pending sends (for tracking what still needs to be sent after returning to app)
export async function savePendingSends(sends: PendingSend[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_PENDING_SENDS, JSON.stringify(sends));
  } catch (error) {
    console.error('[DispatchMessage] Error saving pending sends:', error);
  }
}

// Load pending sends
export async function loadPendingSends(): Promise<PendingSend[]> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY_PENDING_SENDS);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.error('[DispatchMessage] Error loading pending sends:', error);
  }
  return [];
}

// Clear pending sends
export async function clearPendingSends(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY_PENDING_SENDS);
  } catch (error) {
    console.error('[DispatchMessage] Error clearing pending sends:', error);
  }
}

// ============================================================
// NEW MESSAGE QUEUE SYSTEM - Stacks messages instead of replacing
// ============================================================

// Load the message queue
export async function loadMessageQueue(): Promise<QueuedMessage[]> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY_MESSAGE_QUEUE);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Convert recordedTime back to Date objects
      return parsed.map((msg: QueuedMessage) => ({
        ...msg,
        recordedTime: new Date(msg.recordedTime),
      }));
    }
  } catch (error) {
    console.error('[DispatchMessage] Error loading message queue:', error);
  }
  return [];
}

// Save the message queue
export async function saveMessageQueue(queue: QueuedMessage[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_MESSAGE_QUEUE, JSON.stringify(queue));
  } catch (error) {
    console.error('[DispatchMessage] Error saving message queue:', error);
  }
}

// Add a message to the queue (replaces existing if same well, otherwise adds)
export async function addToMessageQueue(data: PullMessageData): Promise<QueuedMessage> {
  let queue = await loadMessageQueue();

  // Remove any existing message for this well (edit replaces original)
  const hadExisting = queue.some(msg => msg.wellName === data.wellName);
  if (hadExisting) {
    queue = queue.filter(msg => msg.wellName !== data.wellName);
    console.log('[DispatchMessage] Removed existing message for:', data.wellName);
  }

  // Add new message
  const newMessage: QueuedMessage = {
    id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    wellName: data.wellName,
    topLevel: data.topLevel,
    bottomLevel: data.bottomLevel,
    recordedTime: data.time,
    bbls: data.bbls,
    isEdit: data.isEdit || hadExisting, // Mark as edit if replacing existing
    queuedAt: Date.now(),
  };

  queue.push(newMessage);
  await saveMessageQueue(queue);

  console.log('[DispatchMessage] Added to queue:', newMessage.wellName, hadExisting ? '(replaced existing)' : '', '| Queue size:', queue.length);
  return newMessage;
}

// Get the first message in the queue (without removing it)
export async function getFirstQueuedMessage(): Promise<QueuedMessage | null> {
  const queue = await loadMessageQueue();
  return queue.length > 0 ? queue[0] : null;
}

// Remove a specific message from the queue by ID
export async function removeFromMessageQueue(messageId: string): Promise<number> {
  const queue = await loadMessageQueue();
  const filtered = queue.filter(msg => msg.id !== messageId);
  await saveMessageQueue(filtered);
  console.log('[DispatchMessage] Removed message', messageId, '| Remaining:', filtered.length);
  return filtered.length;
}

// Remove the first message from the queue
export async function removeFirstFromQueue(): Promise<number> {
  const queue = await loadMessageQueue();
  if (queue.length > 0) {
    queue.shift();
    await saveMessageQueue(queue);
  }
  return queue.length;
}

// Clear the entire message queue
export async function clearMessageQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY_MESSAGE_QUEUE);
    console.log('[DispatchMessage] Message queue cleared');
  } catch (error) {
    console.error('[DispatchMessage] Error clearing message queue:', error);
  }
}

// Get count of messages in queue
export async function getMessageQueueCount(): Promise<number> {
  const queue = await loadMessageQueue();
  return queue.length;
}

// Create pending send queue from pull data
// NOW USES NEW QUEUE SYSTEM - adds to queue instead of replacing
export async function createSendQueue(data: PullMessageData): Promise<QueuedMessage | null> {
  const ready = await isDispatchReady();
  if (!ready) {
    console.log('[DispatchMessage] Dispatch not ready, not adding to queue');
    return null;
  }

  // Add to the new message queue (stacks instead of replacing)
  const queuedMessage = await addToMessageQueue(data);
  return queuedMessage;
}

// Get next pending send and remove it from queue
export async function getNextPendingSend(): Promise<{ send: PendingSend; recipient: DispatchRecipient } | null> {
  const sends = await loadPendingSends();
  if (sends.length === 0) return null;

  const recipients = await loadRecipients();
  const nextSend = sends[0];
  const recipient = recipients.find(r => r.id === nextSend.recipientId);

  if (!recipient) {
    // Recipient was deleted, skip this send
    sends.shift();
    await savePendingSends(sends);
    return getNextPendingSend(); // Recursive call to get next valid one
  }

  return { send: nextSend, recipient };
}

// Mark current send as done and get remaining count
export async function markSendDone(): Promise<number> {
  const sends = await loadPendingSends();
  if (sends.length > 0) {
    sends.shift();
    await savePendingSends(sends);
  }
  return sends.length;
}

// Get count of pending sends
export async function getPendingSendCount(): Promise<number> {
  const sends = await loadPendingSends();
  return sends.length;
}

// Check if dispatch messaging is enabled
export async function isDispatchEnabled(): Promise<boolean> {
  try {
    const enabled = await AsyncStorage.getItem(STORAGE_KEY_DISPATCH_ENABLED);
    return enabled === 'true';
  } catch (error) {
    console.error('[DispatchMessage] Error checking dispatch enabled:', error);
    return false;
  }
}

// Check if dispatch is ready (enabled + has recipients + has template for each)
export async function isDispatchReady(): Promise<boolean> {
  const enabled = await isDispatchEnabled();
  if (!enabled) {
    console.log('[DispatchMessage] Not ready: dispatch is disabled');
    return false;
  }

  const recipients = await getEnabledRecipients();
  if (recipients.length === 0) {
    console.log('[DispatchMessage] Not ready: no enabled recipients');
    return false;
  }

  // Check if we have a default template
  const defaultTemplate = await loadMessageTemplate();
  const hasDefaultTemplate = defaultTemplate && defaultTemplate.template.trim().length > 0;

  // Check if all enabled recipients have either a custom template or we have a default
  const recipientsWithoutTemplate = recipients.filter(r => {
    const hasCustom = r.customTemplate && r.customTemplate.template.trim().length > 0;
    return !hasCustom && !hasDefaultTemplate;
  });

  if (recipientsWithoutTemplate.length > 0) {
    console.log('[DispatchMessage] Not ready: recipients without template:', recipientsWithoutTemplate.map(r => r.name).join(', '));
    return false;
  }

  console.log('[DispatchMessage] Ready! Recipients:', recipients.length, 'Has default template:', hasDefaultTemplate);
  return true;
}

// Check if compact mode is enabled (button only, no banner)
export async function isCompactModeEnabled(): Promise<boolean> {
  try {
    const enabled = await AsyncStorage.getItem(STORAGE_KEY_COMPACT_MODE);
    return enabled === 'true';
  } catch (error) {
    console.error('[DispatchMessage] Error checking compact mode:', error);
    return false;
  }
}

// Set compact mode
export async function setCompactModeEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_COMPACT_MODE, enabled ? 'true' : 'false');
  } catch (error) {
    console.error('[DispatchMessage] Error setting compact mode:', error);
  }
}
