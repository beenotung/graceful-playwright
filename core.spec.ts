import express from 'express'
import { Server } from 'http'
import { Browser, chromium } from 'playwright'
import { GracefulPage } from './core'
import { expect } from 'chai'
import { SinonSpy, fake } from 'sinon'

let server: Server
let origin: string
before(done => {
  let app = express()
  app.get('/', (req, res) => {
    res.end('home page')
  })
  let delayInterval = 0
  app.get('/set-delay', (req, res) => {
    delayInterval = +req.query.ms!
    res.end('updated delay interval')
  })
  app.get('/make-delay', (req, res) => {
    setTimeout(() => {
      res.end('delayed content')
    }, delayInterval)
  })
  server = app.listen(() => {
    let address = server.address()
    if (!address || typeof address != 'object') {
      done('failed to get server port')
      return
    }
    origin = 'http://localhost:' + address.port
    done()
  })
})
after(done => {
  server.close(done)
})

let browser: Browser
let page: GracefulPage
let onError: SinonSpy
before(async () => {
  browser = await chromium.launch()
  onError = fake()
  page = new GracefulPage({
    from: browser,
    retryInterval: 50,
    onError,
  })
})
after(async () => {
  await page.close()
  await browser.close()
})

it('should goto normal page', async () => {
  await page.goto(origin + '/')
  expect(await page.innerText('body')).to.equals('home page')
})

it('should auto retry when timeout', async () => {
  await page.goto(origin + '/set-delay?ms=10')
  expect(await page.innerText('body')).to.equals('updated delay interval')

  setTimeout(() => {
    page.goto(origin + '/set-delay?ms=2')
  }, 30)
  await page.goto(origin + '/make-delay', { timeout: 9 })
  expect(await page.innerText('body')).to.equals('delayed content')
  expect(onError.callCount).to.greaterThanOrEqual(1)
})

it('should fork page', async () => {
  let page2 = page.fork()
  expect(await page2.getPage()).not.equals(await page.getPage())
  await page2.close()
})
