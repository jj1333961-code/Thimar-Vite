const REMEMBERED_ACCOUNT_KEY = "thimar_remembered";

/** Persist the account marker only after the user explicitly opts in. */
export function rememberThisDevice(accountId: string): void {
  if (!accountId.trim()) {
    clearRememberedDevice();
    return;
  }
  try {
    localStorage.setItem(REMEMBERED_ACCOUNT_KEY, accountId);
  } catch {
    // Private browsing / storage-disabled environments must not block sign-in.
  }
}

/** Remove any remembered account marker when the user opts out or signs out. */
export function clearRememberedDevice(): void {
  try {
    localStorage.removeItem(REMEMBERED_ACCOUNT_KEY);
  } catch {
    // Storage may be unavailable; the current in-memory session can still work.
  }
}

/** Return the remembered account id, or null when no durable choice exists. */
export function getRememberedAccountId(): string | null {
  try {
    return localStorage.getItem(REMEMBERED_ACCOUNT_KEY);
  } catch {
    return null;
  }
}
