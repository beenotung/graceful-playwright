import { execSync } from 'child_process'
import { Browser, BrowserContext, chromium, Page } from 'playwright'

let cachedChromiumMajorVersion: string | undefined

/** read from bundled chromium via `chrome --product-version` */
function getChromiumMajorVersion(): string {
  if (!cachedChromiumMajorVersion) {
    let output = execSync(`"${chromium.executablePath()}" --product-version`, {
      encoding: 'utf8',
    }).trim()
    cachedChromiumMajorVersion = output.match(/^(\d+)/)?.[1] ?? '120'
  }
  return cachedChromiumMajorVersion
}

function getPlatformToken(): string {
  if (process.platform === 'darwin') {
    return 'Macintosh; Intel Mac OS X 10_15_7'
  }
  if (process.platform === 'win32') {
    return 'Windows NT 10.0; Win64; x64'
  }
  let arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  return `X11; Linux ${arch}`
}

/** build a non-HeadlessChrome user agent without launching a browser */
export function getStealthUserAgent(): string {
  let major = getChromiumMajorVersion()
  let platform = getPlatformToken()
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
}

/** can be used in args by `chromium.launch()` and `chromium.launchPersistentContext()` */
export function getStealthChromiumArgs(
  options: {
    noSandbox?: boolean
    /** @default getStealthUserAgent() */
    userAgent?: string
  } = {},
): string[] {
  let args: string[] = []

  if (options.noSandbox) {
    args.push('--no-sandbox', '--disable-setuid-sandbox')
  }

  args.push(
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
  )

  let userAgent = options.userAgent || getStealthUserAgent()
  args.push(`--user-agent=${userAgent}`)

  return args
}

/** run via `context.addInitScript(stealthChromeInitScript)` */
export function stealthChromeInitScript() {
  let win = window as any
  win.chrome = win.chrome || {}
  let chrome = win.chrome as {
    app?: unknown
    loadTimes?: () => unknown
    csi?: () => unknown
  }

  function getNavigationTiming() {
    let navigation = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    if (navigation) {
      let timeOrigin = performance.timeOrigin
      let domContentLoadedEventEnd =
        navigation.domContentLoadedEventEnd ||
        navigation.domContentLoadedEventStart ||
        0
      let loadEventEnd =
        navigation.loadEventEnd || domContentLoadedEventEnd || 0
      let responseStart = navigation.responseStart || 0
      return {
        navigationStartMs: timeOrigin,
        navigationStartSec: timeOrigin / 1000,
        domContentLoadedMs: timeOrigin + domContentLoadedEventEnd,
        domContentLoadedSec: (timeOrigin + domContentLoadedEventEnd) / 1000,
        loadEventEndMs: timeOrigin + loadEventEnd,
        loadEventEndSec: (timeOrigin + loadEventEnd) / 1000,
        responseStartSec: (timeOrigin + responseStart) / 1000,
        protocol: navigation.nextHopProtocol || 'http/1.1',
      }
    }

    // fallback for very early init script execution
    let timing = performance.timing
    let navigationStartMs = timing.navigationStart
    let domContentLoadedMs =
      timing.domContentLoadedEventEnd || navigationStartMs
    let loadEventEndMs =
      timing.loadEventEnd ||
      timing.domContentLoadedEventEnd ||
      navigationStartMs
    return {
      navigationStartMs,
      navigationStartSec: navigationStartMs / 1000,
      domContentLoadedMs,
      domContentLoadedSec: domContentLoadedMs / 1000,
      loadEventEndMs,
      loadEventEndSec: loadEventEndMs / 1000,
      responseStartSec: timing.responseStart / 1000,
      protocol: 'http/1.1',
    }
  }

  chrome.app ||= {
    isInstalled: false,
    InstallState: {
      DISABLED: 'disabled',
      INSTALLED: 'installed',
      NOT_INSTALLED: 'not_installed',
    },
    RunningState: {
      CANNOT_RUN: 'cannot_run',
      READY_TO_RUN: 'ready_to_run',
      RUNNING: 'running',
    },
  }

  chrome.loadTimes ||= () => {
    let timing = getNavigationTiming()
    let protocol = timing.protocol
    let usesHttp2Or3 = protocol === 'h2' || protocol === 'h3'
    return {
      requestTime: timing.navigationStartSec,
      startLoadTime: timing.navigationStartSec,
      commitLoadTime: timing.domContentLoadedSec,
      finishDocumentLoadTime: timing.domContentLoadedSec,
      finishLoadTime: timing.loadEventEndSec,
      firstPaintTime: timing.responseStartSec,
      firstPaintAfterLoadTime: 0,
      navigationType: 'Other',
      wasFetchedViaSpdy: usesHttp2Or3,
      wasNpnNegotiated: usesHttp2Or3,
      npnNegotiatedProtocol: usesHttp2Or3 ? protocol : 'unknown',
      wasAlternateProtocolAvailable: false,
      connectionInfo: protocol,
    }
  }

  chrome.csi ||= () => {
    let timing = getNavigationTiming()
    let startE = timing.navigationStartMs
    let onloadT = timing.domContentLoadedMs || startE
    return {
      startE,
      onloadT,
      pageT: performance.now(),
      tran: 15,
    }
  }
}

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
  constructor(
    message: string,
    public details: GotoErrorDetails,
  ) {
    super(message)
  }
}

export function sleep(
  ms: number,
  options?: { extraRandom?: number | false | true },
) {
  if (options?.extraRandom) {
    let extraRandom =
      typeof options.extraRandom === 'number' ? options.extraRandom : ms
    ms += Math.random() * extraRandom
  }
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function sleepUntil(
  conditionFn: () => boolean | Promise<boolean>,
  options?: { interval?: number; timeout?: number; extraRandom?: number },
) {
  let sleepOptions =
    options && 'extraRandom' in options
      ? { extraRandom: options.extraRandom }
      : undefined
  let interval = options?.interval || 1000 / 30 // 30 fps
  let timeout = options?.timeout || 30_000 // 30 seconds
  let endTime = Date.now() + timeout
  while (Date.now() < endTime) {
    if (await conditionFn()) return
    await sleep(interval, sleepOptions)
  }
  throw new Error('Timeout')
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
