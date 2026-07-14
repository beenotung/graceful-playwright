# graceful-playwright

Gracefully handle timeout and network error with auto retry.

[![npm Package Version](https://img.shields.io/npm/v/graceful-playwright)](https://www.npmjs.com/package/graceful-playwright)

## Features

- auto retry when `page.goto()` timeout or encountered `ERR_NETWORK_CHANGED`

- auto restart page when `page.goto()` crashed with `/page crashed/i` error

- helper method to auto retry when failed with `The object has been collected to prevent unbounded heap growth` error

- support restarting page from `Browser` or `BrowserContext` instance

- support wrapping existing `Page` instance

- proxy frequently used methods

- create `Page` instance lazily (on-demand)

- stealth helpers to reduce common Playwright automation signals (`navigator.webdriver`, `HeadlessChrome` user agent, missing `window.chrome`)

## Installation

```bash
npm install graceful-playwright
```

You can install the package with yarn, pnpm or slnpm as well.

## Usage Example

More usage examples see: [example.ts](./example.ts) and [core.spec.ts](./core.spec.ts)

```typescript
import { chromium } from 'playwright'
import { GracefulPage } from 'graceful-playwright'

let browser = await chromium.launch()
let page = new GracefulPage({ from: browser })

let lines: string[] = await page.autoRetryWhenFailed(async () => {
  await page.goto('http://example.net')
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll('a'), a => a.href),
  )
})
console.log('lines:', lines)

await page.close()
await browser.close()
```

## Typescript Signature

Main Class: `GracefulPage`

```typescript
import { Browser, BrowserContext, Page, Response } from 'playwright'

export class GracefulPage {
  constructor(
    public options: {
      from: Browser | BrowserContext
      page?: Page | Promise<Page>
      /**
       * @default 5000 ms
       */
      retryInterval?: number
      /**
       * @default error => console.error(error)
       */
      onError?: (error: unknown) => void
    },
  )

  fork(): GracefulPage

  getPage(): Page | Promise<Page>

  restart(options?: Parameters<Page['close']>[0]): Promise<Page>

  /** @description optimized version of page.close() */
  close: Page['close']

  /**
   * @description graceful version of page.goto()
   * @throws GotoError with response details when got 429 Too Many Requests without retry-after header
   */
  goto(
    url: string,
    /**
     * @default { waitUtil: "domcontentloaded" }
     */
    options?: Parameters<Page['goto']>[1],
  ): Promise<Response | null>

  autoRetryWhenFailed<T>(f: () => T | Promise<T>): Promise<T>

  /** @description proxy method to (await this.getPage())[method] */
  evaluate: Page['evaluate']
  waitForSelector: Page['waitForSelector']
  fill: Page['fill']
  click: Page['click']
  content: Page['content']
  title: Page['title']
  innerHTML: Page['innerHTML']
  innerText: Page['innerText']
}
```

Error Class: `GotoError`

```typescript
export class GotoError extends Error {
  constructor(message: string, public details: GotoErrorDetails)
}

export type GotoErrorDetails = {
  url: string
  options?: Parameters<Page['goto']>[1]
  response: Awaited<ReturnType<Page['goto']>>
}
```

Stealth Helpers

```typescript
/** build a non-HeadlessChrome user agent from bundled chromium version */
export function getStealthUserAgent(): string

/** launch args for chromium.launch() and chromium.launchPersistentContext() */
export function getStealthChromiumArgs(options?: {
  /** opt in for Docker/CI/root; sandbox is enabled by default */
  noSandbox?: boolean
  /** @default getStealthUserAgent() */
  userAgent?: string
}): string[]

/** pass to context.addInitScript(stealthChromeInitScript) */
export function stealthChromeInitScript(): void
```

`getStealthChromiumArgs()` returns:

- `--no-sandbox` (only when `noSandbox: true`)
- `--disable-setuid-sandbox` (only when `noSandbox: true`)
- `--disable-dev-shm-usage`
- `--user-agent=...` (from `options.userAgent` or `getStealthUserAgent()`)
- `--disable-blink-features=AutomationControlled`

`getStealthUserAgent()` builds a `Chrome/${major}.0.0.0` user agent from the bundled chromium binary (`chrome --product-version`) without launching a browser.

`stealthChromeInitScript` patches missing `window.chrome` fields (`app`, `loadTimes`, `csi`) before page scripts run. Pass the function reference to `addInitScript` — do not call it yourself.

Example (see also [example.ts](./example.ts)):

```typescript
import { chromium } from 'playwright'
import {
  getStealthChromiumArgs,
  stealthChromeInitScript,
  GracefulPage,
} from 'graceful-playwright'

let context = await chromium.launchPersistentContext('.chromium', {
  args: getStealthChromiumArgs(),
  // channel: 'chromium', // optional: new headless mode (full chromium engine)
  // channel: 'chrome', // optional: installed Google Chrome
  // headless: false,
})
await context.addInitScript(stealthChromeInitScript)
let page = new GracefulPage({ from: context })

await page.goto('https://example.net')
await context.close()
```

Notes:

- use `noSandbox: true` only in Docker, CI, or when running as root
- use `channel: 'chromium'` for new headless mode — closer to real Chrome than the default headless shell
- use `channel: 'chrome'` when you need installed Google Chrome locally (e.g. codecs, `window.chrome`)
- default (no `channel`) uses bundled headless shell — best for CI; add `stealthChromeInitScript` if sites check `window.chrome`

Helper Functions: `sleep` and `sleepUntil`

```typescript
/**
 * Resolves after the given number of milliseconds.
 * @param options.extraRandom when true, adds up to `ms` of random jitter;
 *   when a number, adds up to that many ms of jitter; default off
 */
export function sleep(
  ms: number,
  options?: { extraRandom?: number | false | true },
): Promise<void>

/**
 * Polls `conditionFn` until it returns true, or throws on timeout.
 * @param options.interval polling interval in ms (default: ~33ms, 30 fps)
 * @param options.timeout overall timeout in ms (default: 30000)
 * @param options.extraRandom passed to each `sleep(interval)` poll wait
 */
export function sleepUntil(
  conditionFn: () => boolean | Promise<boolean>,
  options?: { interval?: number; timeout?: number; extraRandom?: number },
): Promise<void>
```

## License

This project is licensed with [BSD-2-Clause](./LICENSE)

This is free, libre, and open-source software. It comes down to four essential freedoms [[ref]](https://seirdy.one/2021/01/27/whatsapp-and-the-domestication-of-users.html#fnref:2):

- The freedom to run the program as you wish, for any purpose
- The freedom to study how the program works, and change it so it does your computing as you wish
- The freedom to redistribute copies so you can help others
- The freedom to distribute copies of your modified versions to others
