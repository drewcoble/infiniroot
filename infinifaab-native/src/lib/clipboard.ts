import * as Clipboard from 'expo-clipboard';

// The native counterpart to infinifaab (web)'s src/lib/clipboard.ts - same
// signature/call sites (Settings tab's invite-link copy), but no secure-
// context/execCommand fallback dance to do here: expo-clipboard's
// setStringAsync always works on-device, that whole problem is web-only.
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}
