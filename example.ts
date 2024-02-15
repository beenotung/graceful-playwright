import { chromium } from 'playwright'
import { GracefulPage } from './core'

async function main() {
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
}
main().catch(e => console.error(e))
