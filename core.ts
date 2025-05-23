import { Browser, BrowserContext, Page } from 'playwright'

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
  ) {}

  fork() {
    let { page, ...options } = this.options
    return new GracefulPage(options)
  }

  getRetryInterval() {
    return this.options.retryInterval || 5000
  }

  getOnError() {
    return (
      this.options.onError ||
      ((error: unknown) => {
        console.error()
        console.error(error)
      })
    )
  }

  getPage(): Page | Promise<Page> {
    this.options.page ||= this.options.from.newPage()
    return this.options.page
  }

  async restart(options?: Parameters<Page['close']>[0]): Promise<Page> {
    await this.close(options)
    return this.getPage()
  }

  /** @description optimized version of page.close() */
  close: Page['close'] = async (options?: {}) => {
    let promise = Promise.resolve(this.options.page)
      .then(page => page?.close(options))
      .catch(this.getOnError())
    this.options.page = undefined
    return promise
  }

  /**
   * @description graceful version of page.goto()
   * @throws GotoError with response details when got 429 Too Many Requests without retry-after header
   */
  async goto(
    url: string,
    /**
     * @default { waitUtil: "domcontentloaded" }
     */
    options?: Parameters<Page['goto']>[1],
  ) {
    for (;;) {
      let page = await this.getPage()
      try {
        let response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          ...options,
        })
        if (response && response.status() === 429) {
          let headerValue = await response.headerValue('Retry-After')
          let interval = parseRetryAfter(headerValue)
          if (interval) {
            await sleep(interval)
            continue
          }
          let statusText = response.statusText() || 'Too Many Requests'
          throw new GotoError(statusText, { url, options, response })
        }
        return response
      } catch (error) {
        let message = String(error)
        let urlStr = JSON.stringify(url)
        let isKnownError =
          message.includes(
            `Navigation to ${urlStr} is interrupted by another navigation to ${urlStr}`,
          ) ||
          // e.g. 'Timeout 30000ms exceeded'
          /Timeout [\w]+ exceeded/.test(message) ||
          message.includes('ERR_INTERNET_DISCONNECTED') ||
          message.includes('ERR_NETWORK_CHANGED') ||
          message.includes('ERR_CONNECTION_RESET') ||
          message.includes('ERR_SOCKET_NOT_CONNECTED') ||
          message.includes('ERR_ABORTED') ||
          message.includes('ERR_ADDRESS_UNREACHABLE') ||
          message.includes('ERR_NETWORK_IO_SUSPENDED') ||
          /page crashed/i.test(message)
        if (isKnownError) {
          this.getOnError()(error)
          await this.restart()
          await sleep(this.getRetryInterval())
          continue
        }
        throw error
      }
    }
  }

  async autoRetryWhenFailed<T>(f: () => T | Promise<T>) {
    for (;;) {
      try {
        return await f()
      } catch (error) {
        let message = String(error)
        let flags = {
          restart: message.match(
            /The object has been collected to prevent unbounded heap growth/,
          ),
        }
        if (flags.restart) {
          this.getOnError()(error)
          await this.restart()
          await sleep(this.getRetryInterval())
          continue
        }
        throw error
      }
    }
  }

  /** @description proxy method to (await this.getPage()).evaluate */
  evaluate: Page['evaluate'] = async (
    pageFunction: () => unknown,
    arg?: unknown,
  ) => {
    let page = await this.getPage()
    return await page.evaluate(pageFunction, arg)
  }

  /** @description proxy method to (await this.getPage()).waitForSelector */
  waitForSelector: Page['waitForSelector'] = async (
    selector: string,
    options?: {},
  ) => {
    let page = await this.getPage()
    return await page.waitForSelector(selector, options)
  }

  /** @description proxy method to (await this.getPage()).fill */
  fill: Page['fill'] = async (
    selector: string,
    value: string,
    options?: {},
  ) => {
    let page = await this.getPage()
    return await page.fill(selector, value, options)
  }

  /** @description proxy method to (await this.getPage()).click */
  click: Page['click'] = async (selector: string, options?: {}) => {
    let page = await this.getPage()
    return await page.click(selector, options)
  }

  /** @description proxy method to (await this.getPage()).content */
  content: Page['content'] = async () => {
    let page = await this.getPage()
    return await page.content()
  }

  /** @description proxy method to (await this.getPage()).title */
  title: Page['title'] = async () => {
    let page = await this.getPage()
    return await page.title()
  }

  /** @description proxy method to (await this.getPage()).innerHTML */
  innerHTML: Page['innerHTML'] = async (selector: string, options?: {}) => {
    let page = await this.getPage()
    return await page.innerHTML(selector, options)
  }

  /** @description proxy method to (await this.getPage()).innerText */
  innerText: Page['innerText'] = async (selector: string, options?: {}) => {
    let page = await this.getPage()
    return await page.innerText(selector, options)
  }
}

export type GotoErrorDetails = {
  url: string
  options?: Parameters<Page['goto']>[1]
  response: Awaited<ReturnType<Page['goto']>>
}
export class GotoError extends Error {
  constructor(message: string, public details: GotoErrorDetails) {
    super(message)
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function parseRetryAfter(headerValue: string | null): number | null {
  if (!headerValue) return null

  // e.g. 120 (seconds)
  let seconds = +headerValue
  if (seconds) {
    return seconds * 1000
  }

  // e.g. "Wed, 21 Oct 2015 07:28:00 GMT"
  let target = new Date(headerValue).getTime()
  if (target) {
    let diff = target - Date.now()
    return diff
  }

  return null
}
