import { chromium } from 'playwright'
import {
  getStealthChromiumArgs,
  stealthChromeInitScript,
  GracefulPage,
} from './core'

async function main() {
  let userDataDir = '.chromium'
  let context = await chromium.launchPersistentContext(userDataDir, {
    args: getStealthChromiumArgs(),
    // channel: 'chromium',
    // headless: false,
  })
  await context.addInitScript(stealthChromeInitScript)
  let page = new GracefulPage({ from: context })

  let lines: string[] = await page.autoRetryWhenFailed(async () => {
    await page.goto('http://example.net')
    return await page.evaluate(() =>
      Array.from(document.querySelectorAll('a'), a => a.href),
    )
  })
  console.log('lines:', lines)

  await page.close()
  await context.close()
}
main().catch(e => console.error(e))
