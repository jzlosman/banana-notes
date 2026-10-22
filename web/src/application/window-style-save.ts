import { PreferenceSaveQueue, type PreferenceRepository } from './preference-save';
import type { WindowStyle } from '../domain/window-style';

export interface WindowStyleRepository extends PreferenceRepository<WindowStyle> {}
export class WindowStyleSaveQueue extends PreferenceSaveQueue<WindowStyle> {}
