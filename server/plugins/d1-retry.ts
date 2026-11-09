/**
 * Nitro plugin: wraps the D1 binding with retry logic for transient errors.
 *
 * This plugin intercepts the D1 database binding at the Nitro level so that
 * every D1 operation (batch, prepare, exec) across the entire app — including
 * Drizzle ORM calls — automatically retries on transient infrastructure errors.
 *
 * No changes needed in individual route handlers or Drizzle initialization.
 * Just deploy this file and the retry logic is active everywhere.
 */

import { ... } from '../utils/d1-retry'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook("request", (event) => {
    const cf = event.context.cloudflare;
    if (!cf?.env) return;

    const env = cf.env;
    const rawDB = env.DB;
    if (!rawDB || (rawDB as any).__retryWrapped) return;

    // Wrap the D1 binding with retry logic
    const wrapped = withD1Retry(rawDB);
    Object.defineProperty(wrapped, "__retryWrapped", {
      value: true,
      enumerable: false,
    });

    // Replace on the env object so all downstream code (Drizzle, hubDatabase, etc.)
    // picks up the wrapped version automatically.
    try {
      env.DB = wrapped;
    } catch {
      // env might be frozen — fall back to defining the property
      try {
        Object.defineProperty(env, "DB", { value: wrapped, writable: true, configurable: true });
      } catch {
        console.warn("[d1-retry] Could not replace env.DB — use manual integration instead.");
      }
    }
  });
});
