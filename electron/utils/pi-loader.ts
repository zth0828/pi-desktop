// Compatibility shim for cache invalidation. All SDK and internal-module loading lives in pi-adapter.
import { invalidatePiAdapterCache } from '../services/pi-adapter';

export function invalidatePiSdkCache(): void {
  invalidatePiAdapterCache();
}
