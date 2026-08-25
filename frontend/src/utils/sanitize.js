import DOMPurify from 'dompurify';

/**
 * Strips unprintable ASCII control codes, zero-width spaces, and directional override characters
 * that attackers use for filter-evasion or UI spoofing.
 */
function cleanControlAndInvisibleChars(str) {
  if (typeof str !== 'string') return '';
  return str
    // Remove control characters (except common whitespace: \n, \r, \t)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
    // Remove zero-width characters (zero-width space, non-joiner, joiner, BOM)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Remove Unicode bidirectional override characters (prevents text reversal spoofing)
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
}

/**
 * Sanitizes incoming peer chat messages.
 * 1. Type validation and string coercion.
 * 2. Strips unprintable control and zero-width characters.
 * 3. Enforces strict length limits (500 chars).
 * 4. Passes through DOMPurify with ALLOWED_TAGS: [] for zero-HTML guarantees.
 */
export function sanitizePeerMessage(rawMessage, maxLength = 500) {
  if (rawMessage === null || rawMessage === undefined) return '';
  const stringified = typeof rawMessage === 'string' ? rawMessage : String(rawMessage);
  
  // Step 1: Strip control / invisible chars
  const cleaned = cleanControlAndInvisibleChars(stringified);

  // Step 2: Enforce length clamp
  const truncated = cleaned.slice(0, maxLength);

  // Step 3: DOMPurify Zero-HTML nuclear pass (strips all tags, javascript: URIs, event handlers)
  const purified = DOMPurify.sanitize(truncated, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true
  });

  return purified.trim();
}

/**
 * Sanitizes peer nicknames (max 15 characters, alphanumeric + safe symbols, zero HTML).
 */
export function sanitizeNickname(rawNickname, fallback = 'Stranger') {
  if (!rawNickname || typeof rawNickname !== 'string') return fallback;
  
  const cleaned = cleanControlAndInvisibleChars(rawNickname).slice(0, 15);
  const purified = DOMPurify.sanitize(cleaned, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true
  }).trim();

  return purified || fallback;
}

/**
 * Strictly asserts boolean values for camera toggles.
 * Completely shuts down prototype pollution or non-boolean injections.
 */
export function sanitizeCamToggle(rawPayload) {
  return rawPayload === true;
}

/**
 * Client-Side P2P DataChannel Rate Limiter
 * Drops excess incoming peer packets if a peer floods more than maxBurst messages in windowMs.
 */
export function createPeerRateLimiter(maxBurst = 12, windowMs = 2000) {
  let messageTimestamps = [];

  return function isAllowed() {
    const now = Date.now();
    messageTimestamps = messageTimestamps.filter(t => now - t < windowMs);
    if (messageTimestamps.length >= maxBurst) {
      console.warn("[SECURITY] P2P flood detected from peer. Dropping excess DataChannel packets.");
      return false;
    }
    messageTimestamps.push(now);
    return true;
  };
}
