import './viewer.css';
import { BrowserViewerAdapter } from './adapters/browser-viewer';
import { loadViewerFontState } from './adapters/font-catalog';
import { NativeViewerAdapter } from './adapters/native-viewer';
import { ViewerSession } from './application/session';
import { mountViewerApp } from './ui/app';

const appRoot = document.querySelector<HTMLElement>('#app');
if (!appRoot) throw new Error('Banana Viewer could not find its application surface.');

const hasNativeBridge = Boolean((window as Window & { webkit?: { messageHandlers?: { viewer?: unknown } } }).webkit?.messageHandlers?.viewer);
document.documentElement.dataset.native = String(hasNativeBridge);
const adapter = hasNativeBridge ? new NativeViewerAdapter() : new BrowserViewerAdapter();
const session = new ViewerSession(adapter);
const app = mountViewerApp(appRoot, session, loadViewerFontState());
window.addEventListener('pagehide', () => app.dispose(), { once: true });
