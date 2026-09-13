import * as SecureStore from 'expo-secure-store';
import type { TokenStorage } from '@convex-dev/auth/react';

// The React Native counterpart to infinifaab (web)'s authStorage.ts -
// @convex-dev/auth's own docs recommend wrapping expo-secure-store for
// React Native (its default, localStorage, doesn't exist here). Unlike
// infinidraft's cookie-backed storage, this needs no cross-domain sharing
// logic: infinifaab.com's "same account, separate sign-in" convention
// (see infinifaab web's main.tsx) already means this app's own sign-in is
// independent of every other app's, web or native - so a session held
// here never needs to be visible anywhere else, and a plain per-key
// SecureStore wrapper is the whole adapter.
export const secureTokenStorage: TokenStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};
