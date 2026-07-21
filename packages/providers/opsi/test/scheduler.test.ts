import { afterEach, describe, expect, it, vi } from "vitest";
import { OpsiTransport, RequestScheduler, RetryableRequestError } from "../src/index.js";

afterEach(() => {
  vi.useRealTimers();
});

function statusEnvelope(): Response {
  return new Response(
    JSON.stringify({ help: "sanitized", success: true, result: { ckan_version: "2.2b" } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("request scheduling", () => {
  it("paces distinct requests by the default 7000 milliseconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const scheduler = new RequestScheduler();
    const starts: number[] = [];

    await scheduler.schedule("first", false, async () => {
      starts.push(Date.now());
    });
    const second = scheduler.schedule("second", false, async () => {
      starts.push(Date.now());
    });

    await vi.advanceTimersByTimeAsync(6_999);
    expect(starts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(starts).toEqual([0, 7_000]);
  });

  it("bounds retries and applies deterministic exponential backoff with jitter", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const scheduler = new RequestScheduler({
      intervalMs: 0,
      maxRetries: 2,
      retryBaseMs: 100,
      jitterRatio: 0.5,
      random: () => 1,
    });
    const starts: number[] = [];
    const task = vi.fn(async () => {
      starts.push(Date.now());
      if (starts.length < 3) throw new RetryableRequestError("temporary");
      return "ok";
    });

    const result = scheduler.schedule("retry", true, task);
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(149);
    expect(starts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toEqual([0, 150]);
    await vi.advanceTimersByTimeAsync(299);
    expect(starts).toEqual([0, 150]);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe("ok");
    expect(starts).toEqual([0, 150, 450]);
    expect(task).toHaveBeenCalledTimes(3);
  });

  it("does not retry a retryable failure when the operation is not allow-listed", async () => {
    const scheduler = new RequestScheduler({ intervalMs: 0, maxRetries: 3 });
    const task = vi.fn(async () => {
      throw new RetryableRequestError("temporary");
    });

    await expect(scheduler.schedule("not-allow-listed", false, task)).rejects.toThrow("temporary");
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("stops after the configured bounded retry count", async () => {
    const scheduler = new RequestScheduler({
      intervalMs: 0,
      maxRetries: 2,
      retryBaseMs: 0,
      jitterRatio: 0,
    });
    const task = vi.fn(async () => {
      throw new RetryableRequestError("still temporary");
    });

    await expect(scheduler.schedule("bounded", true, task)).rejects.toThrow("still temporary");
    expect(task).toHaveBeenCalledTimes(3);
  });
});

describe("transport retry eligibility", () => {
  it.each(["network", 429, 502, 503, 504] as const)(
    "retries one %s failure for an allow-listed read",
    async (failure) => {
      const fetch = vi.fn(async () => {
        if (fetch.mock.calls.length === 1) {
          if (failure === "network") throw new TypeError("connection reset");
          return new Response("temporarily unavailable", { status: failure });
        }
        return statusEnvelope();
      });
      const transport = new OpsiTransport({
        baseUrl: "https://example.invalid/fixture",
        fetch,
        scheduler: new RequestScheduler({
          intervalMs: 0,
          maxRetries: 1,
          retryBaseMs: 0,
          jitterRatio: 0,
        }),
      });

      await expect(transport.call("status_show", {})).resolves.toMatchObject({
        ckan_version: "2.2b",
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it("does not retry an HTTP status outside the retry allow-list", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ success: false, error: { message: "internal fixture failure" } }),
          { status: 500, headers: { "content-type": "application/json" } },
        ),
    );
    const transport = new OpsiTransport({
      baseUrl: "https://example.invalid/fixture",
      fetch,
      scheduler: new RequestScheduler({
        intervalMs: 0,
        maxRetries: 3,
        retryBaseMs: 0,
        jitterRatio: 0,
      }),
    });

    await expect(transport.call("status_show", {})).rejects.toMatchObject({
      code: "PROVIDER_REQUEST_FAILED",
      exitCode: 4,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
