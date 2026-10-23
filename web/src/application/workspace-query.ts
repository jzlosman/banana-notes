import type { AppearanceState, Capabilities, FeatureState, HotkeyState, StartupState, TypographyState } from './ports';
import type { Library } from '../domain/library';
import type { WindowStyle } from '../domain/window-style';
import { resolvePinnedPreference } from '../domain/window-preferences';

export interface WorkspaceSnapshot {
  library: Library | null;
  appearance: AppearanceState;
  typography: TypographyState;
  windowStyle: WindowStyle;
  focused: boolean;
  features: FeatureState;
  startup: StartupState;
  hotkey: HotkeyState;
  imageOptions: Record<string, unknown>;
  pinned: boolean;
}

const defaultStartup: StartupState = { launchAtLogin: false, launchStatus: 'notRegistered', launchError: null, newNoteOnLaunch: false };

/** Reads independent workspace capabilities as one application query for startup. */
export async function loadWorkspace(capabilities: Capabilities): Promise<WorkspaceSnapshot> {
  const [library, appearance, typography, windowStyle, focused, features, startup, hotkey, imageOptions, pinned] = await Promise.all([
    capabilities.library.load(), capabilities.appearance.load(), capabilities.typography.load(), capabilities.windowStyle.load(),
    capabilities.window.focused(), capabilities.features.load(), capabilities.startup?.load() ?? Promise.resolve(defaultStartup),
    capabilities.hotkey?.load() ?? Promise.resolve({ keyCode: 49, modifiers: (1 << 12) | (1 << 9), display: '⌃⇧Space', registered: false, available: false }),
    capabilities.imagePreferences.load(), capabilities.window.pin?.load() ?? Promise.resolve(resolvePinnedPreference(undefined)),
  ]);
  return { library, appearance, typography, windowStyle, focused, features, startup, hotkey, imageOptions, pinned };
}
