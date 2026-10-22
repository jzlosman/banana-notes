import { NativeBridge } from './adapters/native-bridge';
import { PreviewAdapter } from './adapters/preview';
import { CryptoIdGenerator, SystemClock } from './adapters/system-values';
import { mountApp } from './ui/app';
import type { PlatformPort } from './application/platform';

const platform: PlatformPort = window.webkit?.messageHandlers.native ? new NativeBridge() : new PreviewAdapter();
mountApp(platform, new SystemClock(), new CryptoIdGenerator());
