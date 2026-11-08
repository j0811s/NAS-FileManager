/**
 * ログイン失敗回数をキー（接続元 IP）ごとに数え、上限を超えたら一定時間ロックする。
 * 単一プロセス運用のためプロセス内メモリで保持する（再起動でリセットされる）。
 */
export interface LoginLimiterOptions {
  /** この回数失敗した時点でロックする */
  maxFailures: number;
  /** 失敗を数える期間。最初の失敗からこの時間が過ぎたら数え直す */
  windowMs: number;
  /** ロックする時間 */
  lockMs: number;
  /** テストで時刻を進めるために差し替える */
  now?: () => number;
}

export type LimitCheck = { allowed: true } | { allowed: false; retryAfterSec: number };

export interface LoginLimiter {
  check(key: string): LimitCheck;
  recordFailure(key: string): void;
  recordSuccess(key: string): void;
  /** 保持しているエントリ数（掃除の検証用） */
  size(): number;
}

interface Entry {
  failures: number;
  windowStart: number;
  lockedUntil: number;
}

export const DEFAULT_LOGIN_LIMIT: LoginLimiterOptions = {
  maxFailures: 5,
  windowMs: 15 * 60_000,
  lockMs: 15 * 60_000,
};

export function createLoginLimiter(opts: LoginLimiterOptions = DEFAULT_LOGIN_LIMIT): LoginLimiter {
  const { maxFailures, windowMs, lockMs, now = Date.now } = opts;
  for (const [name, value] of Object.entries({ maxFailures, windowMs, lockMs })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`createLoginLimiter: ${name} must be a positive finite number`);
    }
  }
  const entries = new Map<string, Entry>();

  function isExpired(e: Entry, t: number): boolean {
    return e.lockedUntil <= t && t - e.windowStart >= windowMs;
  }

  function sweep(t: number): void {
    for (const [key, e] of entries) {
      if (isExpired(e, t)) entries.delete(key);
    }
  }

  return {
    check(key) {
      const t = now();
      sweep(t);
      const e = entries.get(key);
      if (e && e.lockedUntil > t) {
        return { allowed: false, retryAfterSec: Math.ceil((e.lockedUntil - t) / 1000) };
      }
      return { allowed: true };
    },

    recordFailure(key) {
      const t = now();
      let e = entries.get(key);
      // ロック中の失敗はロックを延長しない（呼び出し側は check で弾く前提）
      if (e && e.lockedUntil > t) return;
      // ロック解除後、またはウィンドウ経過後は 0 から数え直す
      if (!e || e.lockedUntil > 0 || t - e.windowStart >= windowMs) {
        e = { failures: 0, windowStart: t, lockedUntil: 0 };
        entries.set(key, e);
      }
      e.failures += 1;
      if (e.failures >= maxFailures) e.lockedUntil = t + lockMs;
    },

    recordSuccess(key) {
      entries.delete(key);
    },

    size() {
      return entries.size;
    },
  };
}
