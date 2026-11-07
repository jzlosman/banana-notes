import type { TasksHotkeyPreferencesPort } from '../application/ports';

export interface TasksScreenOptions {
  environment: 'native' | 'preview';
  hotkeyPreferences?: TasksHotkeyPreferencesPort;
  onClose(): void;
  notify(message: string, kind?: 'status' | 'error'): void;
}

export interface MountedTasksScreen {
  onWindowBlur?(): void;
  dispose(): void;
}
