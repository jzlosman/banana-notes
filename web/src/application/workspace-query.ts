import type { AppearanceState, Capabilities, FeatureState, HotkeyState, StartupState, TypographyState } from './ports';
import type { Library } from '../domain/library';
import type { WindowStyle } from '../domain/window-style';

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
    capabilities.hotkey.load(), capabilities.imagePreferences.load(), capabilities.window.pin?.load() ?? Promise.resolve(false),
  ]);
  return { library, appearance, typography, windowStyle, focused, features, startup, hotkey, imageOptions, pinned };
}
