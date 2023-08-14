import { ExtensionStorage } from './generic';
import { STORAGE_VERSION } from '../config/constants';

export interface SessionStorageState {
  hashedPassword: string | undefined;
}

export const sessionDefaults: SessionStorageState = {
  hashedPassword: undefined,
};

// Meant to be used for short-term persisted data. Holds data in memory for the duration of a browser session.
export const sessionExtStorage = new ExtensionStorage<SessionStorageState>(
  chrome.storage.session,
  sessionDefaults,
  STORAGE_VERSION,
);
