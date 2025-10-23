import { Injectable } from '@angular/core';

type LockMode = 'exclusive' | 'shared';

@Injectable({ providedIn: 'root' })
export class LockService {
  private supported = typeof navigator !== 'undefined' && 'locks' in navigator;

  async withLock<T>(
    name: string,
    task: () => Promise<T> | T,
    opts: { mode?: LockMode; ifAvailable?: boolean; onSkip?: () => void } = {}
  ): Promise<T | undefined> {
    const { mode = 'exclusive', ifAvailable = true, onSkip } = opts;

    if (!this.supported) {
      try { return await task(); } catch { /* ignore */ }
      return undefined;
    }

    try {
      // @ts-ignore
      return await navigator.locks.request(
        name,
        { mode, ifAvailable },
        async (lock: any) => {
          if (!lock && ifAvailable) {
            onSkip?.();
            return undefined;
          }
          return await task();
        }
      );
    } catch {
      onSkip?.();
      return undefined;
    }
  }
}
