import { toggleProjectedTask, type ProjectTaskRef, type ToggleTaskResult } from '../domain/project-content';
import type { Library } from '../domain/library';
import type { Clock } from './ports';

/** Write-through commands for projected content, guarded by its source snapshot. */
export class ProjectCommands {
  constructor(private readonly clock: Clock) {}
  toggleTask(library: Library, task: ProjectTaskRef, checked: boolean): ToggleTaskResult {
    return toggleProjectedTask(library, task, checked, this.clock.now());
  }
}
