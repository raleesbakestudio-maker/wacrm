/**
 * Sanitize phone number for Meta WhatsApp API.
 * Meta requires digits only — no + prefix, no spaces, no dashes.
 * e.g. "+370 63949836" → "37063949836"
 */
export function sanitizePhoneForMeta(phone: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Normalize phone number by removing all non-digit characters.
 * Used for comparing phone numbers in different formats.
 */
export function normalizePhone(phone: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Compare two phone numbers accounting for trunk prefix differences.
 * e.g. "370063949836" (with trunk 0) matches "37063949836" (without trunk 0)
 * by comparing the last 8 digits.
 */
export function phonesMatch(phone1: string, phone2: string): boolean {
  const n1 = normalizePhone(phone1)
  const n2 = normalizePhone(phone2)
  if (n1 === n2) return true
  if (n1.length >= 8 && n2.length >= 8) {
    return n1.slice(-8) === n2.slice(-8)
  }
  return false
}

/**
 * Validate phone number is E.164-like format (7-15 digits starting with non-zero).
 * Accepts with or without + prefix.
 */
export function isValidE164(phone: string): boolean {
  return /^\+?[1-9]\d{6,14}$/.test(phone)
}

/**
 * Validate and format phone number for WhatsApp usage.
 * Returns { isValid: boolean, phone: string, sanitized: string, error?: string }.
 *
 * Rules:
 * - Strips all non-digit characters.
 * - Auto-detects 10-digit Indian numbers starting with [6-9] and adds country code 91 (+91).
 * - Handles 11-digit Indian numbers starting with trunk 0 followed by [6-9] -> +91.
 * - Supports all international country codes (7 to 15 digits).
 * - Enforces valid E.164 structure (must start with non-zero digit).
 */
export function validateAndFormatWhatsAppPhone(rawPhone: string): {
  isValid: boolean;
  phone: string;
  sanitized: string;
  error?: string;
} {
  if (!rawPhone || !rawPhone.trim()) {
    return {
      isValid: false,
      phone: '',
      sanitized: '',
      error: 'Phone number is required',
    };
  }

  // Strip all non-digit characters
  let digits = rawPhone.replace(/\D/g, '');

  if (!digits) {
    return {
      isValid: false,
      phone: '',
      sanitized: '',
      error: 'WhatsApp number must contain valid digits',
    };
  }

  // 10 digits starting with 6, 7, 8, or 9: default to India (+91)
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    digits = '91' + digits;
  }
  // 11 digits starting with 0 followed by 6, 7, 8, 9: replace leading trunk 0 with 91
  else if (digits.length === 11 && /^0[6-9]/.test(digits)) {
    digits = '91' + digits.slice(1);
  }

  // Check valid E.164 digits without plus (7 to 15 digits, first digit 1-9)
  if (!/^[1-9]\d{6,14}$/.test(digits)) {
    return {
      isValid: false,
      phone: digits,
      sanitized: digits,
      error: 'Invalid WhatsApp phone number format. Must be 7-15 digits with country code (e.g. +91 98765 43210)',
    };
  }

  return {
    isValid: true,
    phone: '+' + digits,
    sanitized: digits,
  };
}

/**
 * Generate plausible phone number variants for retry when Meta's
 * sandbox rejects a number with error #131030 ("not in allowed list").
 *
 * Many countries use a "trunk prefix" 0 for domestic dialing that is
 * meant to be dropped in international format (e.g. Lithuanian
 * "+370 063 949 836" domestically → "+370 63 949 836" international).
 * But some sandboxes register the number with the trunk 0 included,
 * causing sends to the correct international format to fail.
 *
 * This helper yields up to 3 variants:
 *   1. The original sanitized number (first attempt)
 *   2. With a trunk 0 inserted after the country code
 *   3. With a trunk 0 removed after the country code
 *
 * Country-code lengths of 1, 2, and 3 digits are tried because we
 * don't know the user's country ahead of time.
 *
 * @param sanitized - digits-only phone number (from sanitizePhoneForMeta)
 * @returns deduplicated list of variants, original first
 */
export function phoneVariants(sanitized: string): string[] {
  if (!sanitized) return []
  const seen = new Set<string>()
  const push = (v: string) => {
    if (v && !seen.has(v)) seen.add(v)
  }

  // 1. Original
  push(sanitized)

  // 2. Insert a 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (!rest.startsWith('0')) {
      push(cc + '0' + rest)
    }
  }

  // 3. Remove a leading 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen + 1) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (rest.startsWith('0')) {
      push(cc + rest.slice(1))
    }
  }

  return [...seen]
}

/**
 * Returns true when the Meta API error indicates the recipient
 * phone number isn't in the allowed list (sandbox restriction).
 * Detected via error code 131030 or the standard error text.
 */
export function isRecipientNotAllowedError(message: string): boolean {
  return /131030|not in allowed list|not in the allowed list/i.test(message)
}
