import { describe, expect, it } from "vitest";
import { createLoginLimiter } from "./login-limiter";

const MIN = 60_000;

function setup() {
  let t = 0;
  const limiter = createLoginLimiter({
    maxFailures: 5,
    windowMs: 15 * MIN,
    lockMs: 15 * MIN,
    now: () => t,
  });
  return {
    limiter,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function failTimes(limiter: ReturnType<typeof createLoginLimiter>, key: string, n: number) {
  for (let i = 0; i < n; i++) limiter.recordFailure(key);
}

describe("createLoginLimiter", () => {
  it("上限未満の失敗では許可されたまま", () => {
    const { limiter } = setup();
    failTimes(limiter, "a", 4);
    expect(limiter.check("a")).toEqual({ allowed: true });
  });

  it("上限回数失敗するとロックされ、残り秒数を返す", () => {
    const { limiter } = setup();
    failTimes(limiter, "a", 5);
    expect(limiter.check("a")).toEqual({ allowed: false, retryAfterSec: 15 * 60 });
  });

  it("ロック時間が経過すると再び許可される", () => {
    const { limiter, advance } = setup();
    failTimes(limiter, "a", 5);
    advance(15 * MIN - 1);
    expect(limiter.check("a").allowed).toBe(false);
    advance(1);
    expect(limiter.check("a")).toEqual({ allowed: true });
  });

  it("ロック解除後は失敗回数が 0 から数え直される", () => {
    const { limiter, advance } = setup();
    failTimes(limiter, "a", 5);
    advance(15 * MIN);
    failTimes(limiter, "a", 4);
    expect(limiter.check("a")).toEqual({ allowed: true });
  });

  it("ウィンドウを過ぎた古い失敗は数えない", () => {
    const { limiter, advance } = setup();
    failTimes(limiter, "a", 4);
    advance(15 * MIN);
    failTimes(limiter, "a", 1);
    expect(limiter.check("a")).toEqual({ allowed: true });
  });

  it("成功で失敗回数がリセットされる", () => {
    const { limiter } = setup();
    failTimes(limiter, "a", 4);
    limiter.recordSuccess("a");
    failTimes(limiter, "a", 4);
    expect(limiter.check("a")).toEqual({ allowed: true });
  });

  it("キー（IP）ごとに独立して数える", () => {
    const { limiter } = setup();
    failTimes(limiter, "a", 5);
    expect(limiter.check("b")).toEqual({ allowed: true });
  });

  it("正の有限数でない設定値は拒否する", () => {
    expect(() => createLoginLimiter({ maxFailures: 0, windowMs: MIN, lockMs: MIN })).toThrow();
    expect(() => createLoginLimiter({ maxFailures: 5, windowMs: -1, lockMs: MIN })).toThrow();
    expect(() => createLoginLimiter({ maxFailures: 5, windowMs: MIN, lockMs: NaN })).toThrow();
  });

  it("期限切れのエントリは掃除される", () => {
    const { limiter, advance } = setup();
    failTimes(limiter, "a", 5);
    failTimes(limiter, "b", 1);
    advance(15 * MIN);
    limiter.check("c");
    expect(limiter.size()).toBe(0);
  });
});
