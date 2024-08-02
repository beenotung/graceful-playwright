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

## Installation

```bash
npm install graceful-playwright
```

You can install the package with yarn, pnpm or slnpm as well.

## Usage Example

More usage examples see: [example.ts](./example.ts) and [core.spec.ts](./core.spec.ts)

```typescript
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

  /** @description graceful version of page.goto() */
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

## License

This project is licensed with [BSD-2-Clause](./LICENSE)

This is free, libre, and open-source software. It comes down to four essential freedoms [[ref]](https://seirdy.one/2021/01/27/whatsapp-and-the-domestication-of-users.html#fnref:2):

- The freedom to run the program as you wish, for any purpose
- The freedom to study how the program works, and change it so it does your computing as you wish
- The freedom to redistribute copies so you can help others
- The freedom to distribute copies of your modified versions to others
