/**
 * D1 retry wrapper for transient errors.
 *
 * D1 is backed by a single Durable Object. Transient infrastructure errors
 * (e.g. "Cannot resolve D1 DB due to transient issue on remote node",
 * "Internal error in D1 DB storage caused object to be reset") can cause
 * batch()/prepare().run() to fail momentarily. This wrapper retries those
 * operations automatically.
 *
 * Usage in your Nitro/Nuxt server code:
 *
 *   import { withD1Retry } from "~/server/utils/d1-retry";
 *   const db = withD1Retry(event.context.cloudflare.env.DB);
 *
 * Then use `db` exactly as you would use the raw D1 binding.
 */

/** Milliseconds to wait before the first retry. */
const BASE_DELAY_MS = 100;
/** Maximum number of retry attempts (original + retries). */
const MAX_RETRIES = 3;
/** Cap for the exponential backoff. */
const MAX_DELAY_MS = 2000;

function isTransientD1Error(error: unknown): boolean {
  const msg = String(
    (error as Error)?.message ?? (error as Error)?.cause?.message ?? error,
  ).toLowerCase();

  // Known transient D1 error messages from the D1 error list
  const transientPatterns = [
    "transient issue",
    "object to be reset",
    "cannot resolve d1",
    "d1 database was temporarily unreachable",
    "overloaded",
    "internal error in d1",
    "can't read from request stream",
    "request error", // generic Workers runtime wrapper for failed D1 subrequest
  ];

  return transientPatterns.some((p) => msg.includes(p));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryD1Call<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === MAX_RETRIES || !isTransientD1Error(error)) {
        throw error;
      }
      const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
      console.warn(
        `[d1-retry] Transient D1 error on attempt ${attempt + 1}/${MAX_RETRIES + 1}, retrying in ${delay}ms:`,
        String((error as Error)?.message ?? error),
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Wraps a D1Database binding so that every `batch()`, `prepare()…run/all/first`,
 * and `exec()` call is retried on transient D1 errors.
 */
export function withD1Retry<T extends D1Database>(db: T): T {
  const proxy = new Proxy(db, {
    get(target, prop, receiver) {
      // Wrap batch() — this is where the Sink error originates
      if (prop === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          return retryD1Call(() => target.batch(statements));
        };
      }

      // Wrap exec()
      if (prop === "exec") {
        return (query: string) => retryD1Call(() => target.exec(query));
      }

      // Wrap prepare() — return a proxied prepared statement
      if (prop === "prepare") {
        return (query: string) => {
          const stmt = target.prepare(query);
          return wrapPreparedStatement(stmt) as D1PreparedStatement;
        };
      }

      // Pass through everything else (binding, withSession, etc.)
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return proxy as T;
}

/**
 * Wraps a D1PreparedStatement so that run(), all(), first() are retried.
 * bind() returns a new wrapped statement so chaining works.
 */
function wrapPreparedStatement(stmt: D1PreparedStatement): D1PreparedStatement {
  return new Proxy(stmt, {
    get(target, prop, receiver) {
      if (prop === "run") {
        return () => retryD1Call(() => target.run());
      }
      if (prop === "all") {
        return () => retryD1Call(() => target.all());
      }
      if (prop === "first") {
        return () => retryD1Call(() => target.first());
      }
      if (prop === "bind") {
        return (...values: unknown[]) =>
          wrapPreparedStatement(target.bind(...(values as never[])));
      }
      if (prop === "raw") {
        return (options?: unknown) =>
          retryD1Call(() => (target as any).raw(options));
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
