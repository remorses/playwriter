/**
 * The relay copies a finished Chrome download into Playwright's artifact directory
 * because Chrome refuses Browser.setDownloadBehavior on the tab-scoped debugger session
 * the extension owns, so it always writes downloads to its own download location.
 * download.saveAs() reads <downloadPath>/<guid>, so that copy has to land before
 * Playwright is told the download completed.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WebSocket } from 'ws'
import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { copyDownloadToArtifact } from './cdp-relay.js'

function createDownloadPath(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relay-download-test-'))
}

describe('copyDownloadToArtifact', () => {
  test('copies the file Chrome wrote to the guid path Playwright reads', async () => {
    const downloadPath = createDownloadPath()
    const chromeDownload = path.join(downloadPath, 'chrome-downloads', 'export.json')
    const contents = JSON.stringify({ rows: Array.from({ length: 20 }, (_, index) => index) })
    fs.mkdirSync(path.dirname(chromeDownload), { recursive: true })
    fs.writeFileSync(chromeDownload, contents)

    const failure = await copyDownloadToArtifact({
      downloadPath,
      guid: 'ff93e6c9-367f-480c-9587-bd00c16bca6c',
      filename: chromeDownload,
    })

    expect(failure).toBeUndefined()
    const artifact = path.join(downloadPath, 'ff93e6c9-367f-480c-9587-bd00c16bca6c')
    expect(fs.readFileSync(artifact, 'utf8')).toBe(contents)
    // Chrome keeps its own copy: the user still finds the download where Chrome put it.
    expect(fs.existsSync(chromeDownload)).toBe(true)
    fs.rmSync(downloadPath, { recursive: true, force: true })
  })

  test('creates a download path Playwright has not made yet', async () => {
    const parent = createDownloadPath()
    const downloadPath = path.join(parent, 'artifacts')
    const chromeDownload = path.join(parent, 'report.txt')
    fs.writeFileSync(chromeDownload, 'report')

    const failure = await copyDownloadToArtifact({ downloadPath, guid: 'guid-1', filename: chromeDownload })

    expect(failure).toBeUndefined()
    expect(fs.readFileSync(path.join(downloadPath, 'guid-1'), 'utf8')).toBe('report')
    fs.rmSync(parent, { recursive: true, force: true })
  })

  test('reports why the extension could not locate the finished download', async () => {
    const downloadPath = createDownloadPath()

    const failure = await copyDownloadToArtifact({
      downloadPath,
      guid: 'guid-2',
      error: 'Chrome did not report a finished download for blob:http://localhost/x within 5000ms',
    })

    expect(failure).toMatchInlineSnapshot(`"Download guid-2 finished in Chrome but its file could not be located: Chrome did not report a finished download for blob:http://localhost/x within 5000ms"`)
    expect(fs.readdirSync(downloadPath)).toEqual([])
    fs.rmSync(downloadPath, { recursive: true, force: true })
  })

  test('reports a missing source file instead of leaving Playwright to fail later', async () => {
    const downloadPath = createDownloadPath()
    const missing = path.join(downloadPath, 'gone.txt')

    const failure = await copyDownloadToArtifact({ downloadPath, guid: 'guid-3', filename: missing })

    expect(failure?.startsWith(`Failed to copy download guid-3 from ${missing}`)).toBe(true)
    expect(failure).toContain('ENOENT')
    expect(fs.readdirSync(downloadPath)).toEqual([])
    fs.rmSync(downloadPath, { recursive: true, force: true })
  })
})

/**
 * The protocol path, exercised over real WebSockets with a fake extension and two fake
 * Playwright clients. No browser is involved: what matters here is that the relay puts the
 * finished file where *each* connected client will look for it, before it tells that client
 * the download completed.
 */
describe('download protocol over the relay', () => {
  const TEST_PORT = 19989
  const EXTENSION_ORIGIN = 'chrome-extension://pebbngnfojnignonigcnkdilknapkgid'
  let server: { close(): void } | null = null
  let tempRoot = ''
  let openSockets: Socket[] = []
  const logLines: string[] = []
  const logWaiters = new Set<(line: string) => void>()

  /**
   * Resolves once the relay logs a line containing `fragment`. A client disconnect is
   * handled entirely inside the relay, so its own log line is the only ordered signal a
   * test can wait on: polling the filesystem would only ever prove a timeout.
   */
  function waitForLog(fragment: string): Promise<string> {
    const existing = logLines.find((line) => line.includes(fragment))
    if (existing) {
      return Promise.resolve(existing)
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        logWaiters.delete(notify)
        reject(new Error(`Timed out waiting for relay log containing "${fragment}"`))
      }, 4000)
      const notify = (line: string): void => {
        if (!line.includes(fragment)) {
          return
        }
        clearTimeout(timer)
        logWaiters.delete(notify)
        resolve(line)
      }
      logWaiters.add(notify)
    })
  }

  const recordLog = (...args: any[]): void => {
    const line = args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' ')
    logLines.push(line)
    for (const notify of Array.from(logWaiters)) {
      notify(line)
    }
  }

  beforeAll(async () => {
    const { startPlayWriterCDPRelayServer } = await import('./cdp-relay.js')
    server = await startPlayWriterCDPRelayServer({
      port: TEST_PORT,
      logger: { log: recordLog, error: recordLog },
    })
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-download-protocol-'))
  })

  // Every socket closes here rather than at the end of each test, so one failing
  // assertion cannot leave a second extension connected and break the tests after it.
  afterEach(async () => {
    const toClose = openSockets
    openSockets = []
    await Promise.all(toClose.map((socket) => socket.close()))
  })

  afterAll(async () => {
    server?.close()
    server = null
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  type Message = Record<string, any>

  type Socket = {
    ws: WebSocket
    messages: Message[]
    send(message: Message): void
    /** Resolves with the first message matching the predicate, past or future. */
    waitFor(predicate: (message: Message) => boolean, description: string): Promise<Message>
    close(): Promise<void>
  }

  async function connect(url: string, headers?: Record<string, string>): Promise<Socket> {
    const ws = new WebSocket(url, headers ? { headers } : undefined)
    const messages: Message[] = []
    const waiters = new Set<(message: Message) => void>()

    ws.on('message', (data: Buffer) => {
      const message = JSON.parse(data.toString()) as Message
      messages.push(message)
      for (const notify of Array.from(waiters)) {
        notify(message)
      }
    })

    await new Promise<void>((resolve, reject) => {
      const onOpen = (): void => {
        ws.off('error', onError)
        ws.off('close', onClose)
        // Keep the socket's own error handled for the rest of the test.
        ws.on('error', () => {})
        resolve()
      }
      const onError = (error: Error): void => reject(error)
      const onClose = (code: number, reason: Buffer): void => {
        reject(new Error(`${url} closed before opening: ${code} ${reason.toString()}`))
      }
      ws.once('open', onOpen)
      ws.once('error', onError)
      ws.once('close', onClose)
    })

    const socket: Socket = {
      ws,
      messages,
      send(message) {
        ws.send(JSON.stringify(message))
      },
      waitFor(predicate, description) {
        const existing = messages.find(predicate)
        if (existing) {
          return Promise.resolve(existing)
        }
        return new Promise<Message>((resolve, reject) => {
          const timer = setTimeout(() => {
            waiters.delete(notify)
            reject(new Error(`Timed out waiting for ${description}; saw ${JSON.stringify(messages)}`))
          }, 4000)
          const notify = (message: Message): void => {
            if (!predicate(message)) {
              return
            }
            clearTimeout(timer)
            waiters.delete(notify)
            resolve(message)
          }
          waiters.add(notify)
        })
      },
      close() {
        return new Promise<void>((resolve) => {
          if (ws.readyState === ws.CLOSED) {
            resolve()
            return
          }
          ws.once('close', () => resolve())
          ws.close()
        })
      },
    }
    openSockets.push(socket)
    return socket
  }

  function connectExtension(installId?: string): Promise<Socket> {
    const query = installId ? `?installId=${installId}&browser=chrome` : ''
    return connect(`ws://127.0.0.1:${TEST_PORT}/extension${query}`, { origin: EXTENSION_ORIGIN })
  }

  /** Connection ids the relay assigned, in the order the extensions connected. */
  async function extensionIdsByInstallId(): Promise<Record<string, string>> {
    const response = await fetch(`http://127.0.0.1:${TEST_PORT}/extensions/status`)
    const body = (await response.json()) as { extensions: { extensionId: string; stableKey: string }[] }
    return Object.fromEntries(
      body.extensions.map((extension) => [extension.stableKey.split(':').pop() as string, extension.extensionId]),
    )
  }

  /** Connects a Playwright client and tells the relay where its artifacts live. */
  async function connectClient({
    clientId,
    downloadPath,
    extensionId,
  }: {
    clientId: string
    downloadPath?: string
    extensionId?: string
  }): Promise<Socket> {
    const query = extensionId ? `?extensionId=${extensionId}` : ''
    const client = await connect(`ws://127.0.0.1:${TEST_PORT}/cdp/${clientId}${query}`)
    if (downloadPath) {
      client.send({
        id: 1,
        method: 'Browser.setDownloadBehavior',
        params: { behavior: 'allowAndName', downloadPath, eventsEnabled: true },
      })
      await client.waitFor((message) => message.id === 1, `setDownloadBehavior ack for ${clientId}`)
    }
    return client
  }

  /** Writes the file Chrome would have written, outside every artifact directory. */
  function writeChromeDownload({ name, contents }: { name: string; contents: string }): string {
    const chromeDir = path.join(tempRoot, 'chrome-downloads')
    fs.mkdirSync(chromeDir, { recursive: true })
    const file = path.join(chromeDir, name)
    fs.writeFileSync(file, contents)
    return file
  }

  function artifactDir(name: string): string {
    return path.join(tempRoot, name)
  }

  function isDownloadProgress(message: Message): boolean {
    return message.method === 'Page.downloadProgress'
  }

  test('materializes the finished download for every connected client, not just the last one', async () => {
    const extension = await connectExtension()
    const pathA = artifactDir('client-a')
    const pathB = artifactDir('client-b')
    // B sets download behavior last: before this fix its path was the only one written.
    const clientA = await connectClient({ clientId: 'multi-a', downloadPath: pathA })
    const clientB = await connectClient({ clientId: 'multi-b', downloadPath: pathB })

    const guid = 'a1111111-1111-4111-8111-111111111111'
    const contents = 'id,total\n1,42\n'
    const chromeFile = writeChromeDownload({ name: 'export.csv', contents })

    // The file has to be in place before the client is told the download completed, so
    // both clients record what they could see at the moment the event arrived.
    const seenByA = clientA.waitFor(isDownloadProgress, 'downloadProgress on A').then((message) => ({
      message,
      artifactExisted: fs.existsSync(path.join(pathA, guid)),
    }))
    const seenByB = clientB.waitFor(isDownloadProgress, 'downloadProgress on B').then((message) => ({
      message,
      artifactExisted: fs.existsSync(path.join(pathB, guid)),
    }))

    extension.send({ method: 'downloadCompleted', params: { guid, filename: chromeFile } })
    extension.send({
      method: 'forwardCDPEvent',
      params: { sessionId: 'pw-tab-1', method: 'Page.downloadProgress', params: { guid, state: 'completed' } },
    })

    const resultA = await seenByA
    const resultB = await seenByB
    expect(resultA.message.params.state).toBe('completed')
    expect(resultB.message.params.state).toBe('completed')
    expect(resultA.artifactExisted).toBe(true)
    expect(resultB.artifactExisted).toBe(true)
    expect(fs.readFileSync(path.join(pathA, guid), 'utf8')).toBe(contents)
    expect(fs.readFileSync(path.join(pathB, guid), 'utf8')).toBe(contents)

    // Playwright's CDP client listens for the Browser.* aliases, so both must arrive too.
    await clientA.waitFor((m) => m.method === 'Browser.downloadProgress', 'Browser.downloadProgress on A')
    await clientB.waitFor((m) => m.method === 'Browser.downloadProgress', 'Browser.downloadProgress on B')

  })

  test('materializes for a client that registers its path while the copy is in flight', async () => {
    const extension = await connectExtension()
    const pathA = artifactDir('inflight-a')
    const pathB = artifactDir('inflight-b')
    const clientA = await connectClient({ clientId: 'inflight-a', downloadPath: pathA })
    // B is connected and will receive the completed event, but the relay does not know
    // where its artifacts go yet.
    const clientB = await connectClient({ clientId: 'inflight-b' })

    const guid = 'c3333333-3333-4333-8333-333333333333'
    // Big enough that copying it for A takes far longer than a message from B crossing a
    // loopback socket, which is what puts B's registration inside the copy.
    const contents = `${'A'.repeat(16 * 1024 * 1024 - 4)}TAIL`
    const chromeFile = writeChromeDownload({ name: 'big-export.bin', contents })

    const seenByA = clientA.waitFor(isDownloadProgress, 'downloadProgress on A').then((message) => ({
      message,
      artifactExisted: fs.existsSync(path.join(pathA, guid)),
    }))
    const seenByB = clientB.waitFor(isDownloadProgress, 'downloadProgress on B').then((message) => ({
      message,
      artifactExisted: fs.existsSync(path.join(pathB, guid)),
    }))

    extension.send({ method: 'downloadCompleted', params: { guid, filename: chromeFile } })
    extension.send({
      method: 'forwardCDPEvent',
      params: { sessionId: 'pw-tab-1', method: 'Page.downloadProgress', params: { guid, state: 'completed' } },
    })
    // Sent while the relay is already copying for A. Reading the client paths once, before
    // the copies, leaves B out of them and still sends B the completed event.
    clientB.send({
      id: 7,
      method: 'Browser.setDownloadBehavior',
      params: { behavior: 'allowAndName', downloadPath: pathB, eventsEnabled: true },
    })
    await clientB.waitFor((message) => message.id === 7, 'setDownloadBehavior ack for inflight-b')

    const resultA = await seenByA
    const resultB = await seenByB
    expect(resultA.message.params.state).toBe('completed')
    expect(resultB.message.params.state).toBe('completed')
    expect(resultA.artifactExisted).toBe(true)
    expect(resultB.artifactExisted).toBe(true)
    const artifactB = fs.readFileSync(path.join(pathB, guid), 'utf8')
    expect(artifactB.length).toBe(contents.length)
    expect(artifactB.endsWith('TAIL')).toBe(true)
  })

  test('stops writing artifacts for a client that disconnected', async () => {
    const extension = await connectExtension()
    const pathA = artifactDir('stay')
    const pathB = artifactDir('leave')
    const clientA = await connectClient({ clientId: 'disc-a', downloadPath: pathA })
    const clientB = await connectClient({ clientId: 'disc-b', downloadPath: pathB })
    await clientB.close()
    // The relay logs this only after it has dropped the client's artifact directory.
    await waitForLog('Playwright client disconnected: disc-b')

    const guid = 'b2222222-2222-4222-8222-222222222222'
    const chromeFile = writeChromeDownload({ name: 'after-disconnect.txt', contents: 'still here' })

    const seenByA = clientA.waitFor(isDownloadProgress, 'downloadProgress after disconnect')
    extension.send({ method: 'downloadCompleted', params: { guid, filename: chromeFile } })
    extension.send({
      method: 'forwardCDPEvent',
      params: { method: 'Page.downloadProgress', params: { guid, state: 'completed' } },
    })

    expect((await seenByA).params.state).toBe('completed')
    expect(fs.readFileSync(path.join(pathA, guid), 'utf8')).toBe('still here')
    expect(fs.existsSync(path.join(pathB, guid))).toBe(false)

    // Playwright reuses client ids across sessions. A behaviour left behind by the previous
    // holder of this id would silently resurrect its artifact directory here.
    const reconnected = await connectClient({ clientId: 'disc-b' })
    const secondGuid = 'b2222222-2222-4222-8222-222222222299'
    const secondSeen = reconnected.waitFor(isDownloadProgress, 'downloadProgress after reconnect')
    extension.send({ method: 'downloadCompleted', params: { guid: secondGuid, filename: chromeFile } })
    extension.send({
      method: 'forwardCDPEvent',
      params: { method: 'Page.downloadProgress', params: { guid: secondGuid, state: 'completed' } },
    })

    expect((await secondSeen).params.state).toBe('completed')
    expect(fs.existsSync(path.join(pathB, secondGuid))).toBe(false)
    expect(fs.readFileSync(path.join(pathA, secondGuid), 'utf8')).toBe('still here')
  })

  test('keeps a download inside the extension it came from', async () => {
    const extensionOne = await connectExtension('profile-one')
    await connectExtension('profile-two')
    const ids = await extensionIdsByInstallId()
    const pathOne = artifactDir('extension-one')
    const pathTwo = artifactDir('extension-two')
    const clientOne = await connectClient({
      clientId: 'ext-one-client',
      downloadPath: pathOne,
      extensionId: ids['profile-one'],
    })
    await connectClient({
      clientId: 'ext-two-client',
      downloadPath: pathTwo,
      extensionId: ids['profile-two'],
    })

    const guid = '44444444-dddd-4ddd-8ddd-dddddddddddd'
    const chromeFile = writeChromeDownload({ name: 'scoped.txt', contents: 'scoped' })
    const seen = clientOne.waitFor(isDownloadProgress, 'downloadProgress on the first extension')
    extensionOne.send({ method: 'downloadCompleted', params: { guid, filename: chromeFile } })
    extensionOne.send({
      method: 'forwardCDPEvent',
      params: { method: 'Page.downloadProgress', params: { guid, state: 'completed' } },
    })

    expect((await seen).params.state).toBe('completed')
    expect(fs.readFileSync(path.join(pathOne, guid), 'utf8')).toBe('scoped')
    // The other browser profile never saw this download and must not receive its file.
    expect(fs.existsSync(path.join(pathTwo, guid))).toBe(false)
  })

  test('reports a download whose file could not be found as cancelled', async () => {
    const extension = await connectExtension()
    const downloadPath = artifactDir('failure')
    const client = await connectClient({ clientId: 'fail-1', downloadPath })

    const guid = 'c3333333-3333-4333-8333-333333333333'
    const seen = client.waitFor(isDownloadProgress, 'cancelled downloadProgress')
    extension.send({
      method: 'downloadCompleted',
      params: { guid, error: 'Chrome did not report download 4 finished within 5000ms' },
    })
    extension.send({
      method: 'forwardCDPEvent',
      params: { method: 'Page.downloadProgress', params: { guid, state: 'completed' } },
    })

    // Playwright turns a cancelled download into a rejected saveAs() instead of letting it
    // read a file that is not there.
    expect((await seen).params.state).toBe('canceled')
    expect(fs.existsSync(path.join(downloadPath, guid))).toBe(false)

    const browserEvent = await client.waitFor((m) => m.method === 'Browser.downloadProgress', 'Browser alias')
    expect(browserEvent.params.state).toBe('canceled')

  })

  test('reports a source file Chrome moved away as cancelled rather than a missing artifact', async () => {
    const extension = await connectExtension()
    const downloadPath = artifactDir('moved')
    const client = await connectClient({ clientId: 'moved-1', downloadPath })

    const guid = 'd4444444-4444-4444-8444-444444444444'
    const seen = client.waitFor(isDownloadProgress, 'cancelled downloadProgress for missing source')
    extension.send({
      method: 'downloadCompleted',
      params: { guid, filename: path.join(tempRoot, 'chrome-downloads', 'deleted-by-user.bin') },
    })
    extension.send({
      method: 'forwardCDPEvent',
      params: { method: 'Page.downloadProgress', params: { guid, state: 'completed' } },
    })

    expect((await seen).params.state).toBe('canceled')
    expect(fs.existsSync(path.join(downloadPath, guid))).toBe(false)

  })

  test('passes a cancelled download through without waiting for a file', async () => {
    const extension = await connectExtension()
    const downloadPath = artifactDir('cancelled')
    const client = await connectClient({ clientId: 'cancel-1', downloadPath })

    const guid = 'e5555555-5555-4555-8555-555555555555'
    const seen = client.waitFor(isDownloadProgress, 'passthrough cancellation')
    extension.send({
      method: 'forwardCDPEvent',
      params: { method: 'Page.downloadProgress', params: { guid, state: 'canceled' } },
    })

    expect((await seen).params.state).toBe('canceled')
    expect(fs.existsSync(downloadPath) && fs.readdirSync(downloadPath).includes(guid)).toBe(false)

  })

  test('leaves an extension too old to report a path on its previous behaviour', async () => {
    const extension = await connectExtension()
    const downloadPath = artifactDir('legacy')
    const client = await connectClient({ clientId: 'legacy-1', downloadPath })

    const guid = 'f6666666-6666-4666-8666-666666666666'
    const seen = client.waitFor(isDownloadProgress, 'unmodified downloadProgress')
    // No downloadCompleted message: an old extension never sends one.
    extension.send({
      method: 'forwardCDPEvent',
      params: { method: 'Page.downloadProgress', params: { guid, state: 'completed' } },
    })

    expect((await seen).params.state).toBe('completed')

  })

  test('keeps each download report bound to its own guid', async () => {
    const extension = await connectExtension()
    const downloadPath = artifactDir('two-guids')
    const client = await connectClient({ clientId: 'guids-1', downloadPath })

    const firstGuid = '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const secondGuid = '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const firstFile = writeChromeDownload({ name: 'first.csv', contents: 'first' })
    const secondFile = writeChromeDownload({ name: 'second.csv', contents: 'second' })

    extension.send({ method: 'downloadCompleted', params: { guid: firstGuid, filename: firstFile } })
    extension.send({ method: 'downloadCompleted', params: { guid: secondGuid, filename: secondFile } })
    extension.send({
      method: 'forwardCDPEvent',
      params: { method: 'Page.downloadProgress', params: { guid: secondGuid, state: 'completed' } },
    })
    await client.waitFor(
      (m) => isDownloadProgress(m) && m.params.guid === secondGuid,
      'downloadProgress for the second guid',
    )
    extension.send({
      method: 'forwardCDPEvent',
      params: { method: 'Page.downloadProgress', params: { guid: firstGuid, state: 'completed' } },
    })
    await client.waitFor(
      (m) => isDownloadProgress(m) && m.params.guid === firstGuid,
      'downloadProgress for the first guid',
    )

    expect(fs.readFileSync(path.join(downloadPath, firstGuid), 'utf8')).toBe('first')
    expect(fs.readFileSync(path.join(downloadPath, secondGuid), 'utf8')).toBe('second')

  })

  test('writes nothing when no client asked for downloads to be saved', async () => {
    const extension = await connectExtension()
    const client = await connectClient({ clientId: 'nobehavior-1' })

    const guid = '33333333-cccc-4ccc-8ccc-cccccccccccc'
    const chromeFile = writeChromeDownload({ name: 'ignored.txt', contents: 'ignored' })
    const seen = client.waitFor(isDownloadProgress, 'downloadProgress without behaviour')
    extension.send({ method: 'downloadCompleted', params: { guid, filename: chromeFile } })
    extension.send({
      method: 'forwardCDPEvent',
      params: { method: 'Page.downloadProgress', params: { guid, state: 'completed' } },
    })

    expect((await seen).params.state).toBe('completed')
    expect(fs.existsSync(path.join(tempRoot, guid))).toBe(false)

  })
})
