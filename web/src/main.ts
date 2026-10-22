import { NativeBridge } from './adapters/native-bridge';
import { PreviewAdapter } from './adapters/preview';
import { CryptoIdGenerator, SystemClock } from './adapters/system-values';
import { mountApp } from './ui/app';
import type { Capabilities } from './application/ports';

declare global {
  interface Window { webkit?: { messageHandlers: { native?: unknown } } }
}

const capabilities: Capabilities = window.webkit?.messageHandlers.native ? new NativeBridge() : new PreviewAdapter();
mountApp(capabilities, new SystemClock(), new CryptoIdGenerator());
