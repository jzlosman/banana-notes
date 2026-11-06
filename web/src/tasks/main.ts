import './tasks.css';
import { loadTasksFontState } from './adapters/font-catalog';
import { TASKS_BRIDGE_NAME } from './adapters/native-contract';
import { NativeTasksAdapter } from './adapters/native-tasks';
import { PreviewTasksAdapter } from './adapters/preview-tasks';
import { TasksController } from './application/controller';
import { mountTasksApp } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Banana Tasks could not find its application surface.');

const native = Boolean((window as Window & { webkit?: { messageHandlers?: Record<string, unknown> } }).webkit?.messageHandlers?.[TASKS_BRIDGE_NAME]);
document.documentElement.dataset.native = String(native);
const ports = native ? new NativeTasksAdapter() : new PreviewTasksAdapter();
const controller = new TasksController(ports);
const app = mountTasksApp(root, controller, { window: ports.window, fontState: loadTasksFontState() });
window.addEventListener('pagehide', () => { app.dispose(); controller.dispose(); }, { once: true });
