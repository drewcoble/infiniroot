// navigator.clipboard requires a secure context (HTTPS or localhost) - it's
// silently unavailable when this app is opened over plain HTTP on a local
// network address (e.g. http://192.168.1.x:5052 on a phone), which is
// exactly how this app gets tested on a real device. Falls back to the
// old textarea + document.execCommand("copy") trick, which has no secure-
// context requirement, only a real user-gesture call site (a click
// handler, same as this is always used from).
export async function copyToClipboard(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path below.
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
}
