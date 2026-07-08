import { isPlaywrightOfsScript } from './playwrightOfsScripts.js';

class AsyncMutex {
  constructor() {
    this.locked = false;
    this.waiters = [];
  }

  async acquire() {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    await new Promise((resolve) => {
      this.waiters.push(resolve);
    });
    return () => this.release();
  }

  release() {
    if (this.waiters.length) {
      const next = this.waiters.shift();
      next();
      return;
    }
    this.locked = false;
  }
}

const playwrightMutex = new AsyncMutex();

/** Garante no máximo 1 job Playwright/OFS ativo por vez. */
export async function withPlaywrightOfsGate(script, fn) {
  if (!isPlaywrightOfsScript(script)) {
    return fn();
  }
  const release = await playwrightMutex.acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
