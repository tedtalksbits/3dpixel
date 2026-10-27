// API keys. Desktop: the OS keychain (Windows Credential Manager, macOS Keychain, Secret Service),
// via the Rust side, so the key never sits in a file. Web: localStorage, which only this browser
// profile can read but which is not encrypted.

import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './platform';

const LOCAL = (name: string) => `3dpixel.secret.${name}`;

export const secretStore = isDesktop ? 'your system keychain' : "this browser's local storage";

export async function getSecret(name: string): Promise<string | null> {
  if (isDesktop) return invoke<string | null>('secret_get', { name });
  try {
    return localStorage.getItem(LOCAL(name));
  } catch {
    return null;
  }
}

export async function setSecret(name: string, value: string | null): Promise<void> {
  if (isDesktop) return invoke('secret_set', { name, value });
  try {
    if (value) localStorage.setItem(LOCAL(name), value);
    else localStorage.removeItem(LOCAL(name));
  } catch {
    throw new Error('This browser blocks local storage, so the key cannot be saved.');
  }
}
