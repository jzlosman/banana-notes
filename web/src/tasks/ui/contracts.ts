export interface TasksScreenOptions {
  environment: 'native' | 'preview';
  onClose(): void;
  notify(message: string, kind?: 'status' | 'error'): void;
}

export interface MountedTasksScreen {
  dispose(): void;
}
