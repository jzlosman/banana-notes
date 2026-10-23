import type { AppCommand, AppCommandHandler } from '../application/ports';

export interface AppCommandActions {
  isReady(): boolean;
  defer(command: AppCommand): void;
  newNote(): void;
  showExplorer(): void;
  selectNotebook(tag: string | null): void;
  showHelp(): void;
  showSettings(): void;
  focusChanged(focused: boolean): void;
  pinChanged(pinned: boolean): void;
  changeWindowStyle(style: Extract<AppCommand, { type: 'window-style' }>['style']): void;
  changeFontSize(adjustment: Extract<AppCommand, { type: 'font-size' }>['adjustment']): void;
  copy(format: Extract<AppCommand, { type: 'copy' }>['format'], whole: boolean): Promise<void>;
  flush(): Promise<void>;
  focusEditor(): void;
  move(direction: 1 | -1): void;
}

/** Routes decoded boundary commands into UI actions; early commands wait for the loaded session. */
export function createAppCommandHandler(actions: AppCommandActions): AppCommandHandler {
  return async command => {
    if (!actions.isReady()) { actions.defer(command); return; }
    switch (command.type) {
      case 'new-note': actions.newNote(); break;
      case 'show-explorer': actions.showExplorer(); break;
      case 'select-notebook': actions.selectNotebook(command.tag); break;
      case 'help': actions.showHelp(); break;
      case 'settings': actions.showSettings(); break;
      case 'focus-change': actions.focusChanged(command.focused); break;
      case 'pin-change': actions.pinChanged(command.pinned); break;
      case 'window-style': actions.changeWindowStyle(command.style); break;
      case 'font-size': actions.changeFontSize(command.adjustment); break;
      case 'copy': await actions.copy(command.format, command.whole); break;
      case 'flush': await actions.flush(); break;
      case 'focus-editor': actions.focusEditor(); break;
      case 'older-note': actions.move(1); break;
      case 'newer-note': actions.move(-1); break;
    }
  };
}
