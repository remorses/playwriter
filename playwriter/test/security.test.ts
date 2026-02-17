
import { describe, it, expect, afterEach } from 'vitest'
import { startPlayWriterCDPRelayServer } from '../src/cdp-relay.js'
import { WebSocket } from 'ws'
import { createFileLogger } from '../src/create-logger.js'
import { killPortProcess } from '../src/kill-port.js'

const TEST_PORT = 19999

async function killProcessOnPort(port: number): Promise<void> {
    try {
        await killPortProcess({ port })
    } catch (err) {
        // Ignore if no process is running
    }
}

describe('Security Tests', () => {
    let server: any = null

    afterEach(async () => {
        if (server) {
            server.close()
            server = null
        }
        await killProcessOnPort(TEST_PORT)
    })

    it('should enforce token authentication for /cdp endpoint', async () => {
        const token = 'secret-token'
        const logger = createFileLogger()
        
        server = await startPlayWriterCDPRelayServer({
            port: TEST_PORT,
            token,
            logger
        })

        // Helper to try connecting
        const tryConnect = (tokenParam?: string) => {
            return new Promise<void>((resolve, reject) => {
                const url = `ws://127.0.0.1:${TEST_PORT}/cdp${tokenParam ? `?token=${tokenParam}` : ''}`
                const ws = new WebSocket(url)
                
                ws.on('open', () => {
                    ws.close()
                    resolve()
                })
                
                ws.on('error', (err) => {
                    reject(err)
                })

                 ws.on('unexpected-response', (req, res) => {
                    reject(new Error(`Unexpected response: ${res.statusCode}`))
                    ws.close()
                 })
            })
        }

        // 1. No token -> Should fail
        await expect(tryConnect()).rejects.toThrow(/Unexpected response: (400|401|403)/)

        // 2. Wrong token -> Should fail
        await expect(tryConnect('wrong-token')).rejects.toThrow(/Unexpected response: (400|401|403)/)

        // 3. Correct token -> Should succeed
        await expect(tryConnect(token)).resolves.not.toThrow()
    })

    it('should enforce localhost restrictions for /extension endpoint', async () => {
        const logger = createFileLogger()
        server = await startPlayWriterCDPRelayServer({
            port: TEST_PORT,
            logger
        })

        const tryConnectExtension = (origin?: string) => {
            return new Promise<void>((resolve, reject) => {
                const url = `ws://127.0.0.1:${TEST_PORT}/extension`
                const options = origin ? { headers: { Origin: origin } } : {}
                const ws = new WebSocket(url, options)

                ws.on('open', () => {
                    ws.close()
                    resolve()
                })

                ws.on('error', (err) => {
                    reject(err)
                })
                
                ws.on('unexpected-response', (req, res) => {
                    reject(new Error(`Unexpected response: ${res.statusCode}`))
                    ws.close()
                })
            })
        }

        // 1. Valid chrome-extension origin -> Should succeed
        // Use a valid extension ID from ALLOWED_EXTENSION_IDS in cdp-relay.ts
        await expect(tryConnectExtension('chrome-extension://jfeammnjpkecdekppnclgkkffahnhfhe')).resolves.not.toThrow()

        // 2. Invalid origin (e.g., http://evil.com) -> Should fail
        await expect(tryConnectExtension('http://evil.com')).rejects.toThrow(/Unexpected response: (400|401|403)/)
        
        // 3. No origin -> Should likely fail if strict checking is enabled, but typically extension connection requires specific origin handling. 
        // Based on implementation, usually it checks if it starts with chrome-extension://
        await expect(tryConnectExtension()).rejects.toThrow(/Unexpected response: (400|401|403)/)
    })

    // =========================================================================
    // Privileged HTTP route hardening (/cli/*, /recording/*)
    //
    // These tests verify that cross-origin browser requests are blocked even
    // without CORS preflight (the "simple request" attack vector where POST +
    // Content-Type: text/plain bypasses CORS entirely).
    // =========================================================================

    const httpRequest = ({ path, method = 'POST', headers = {} }: {
        path: string
        method?: string
        headers?: Record<string, string>
    }) => {
        return fetch(`http://127.0.0.1:${TEST_PORT}${path}`, {
            method,
            headers,
            body: method === 'POST' ? JSON.stringify({ sessionId: '1', code: 'true' }) : undefined,
        })
    }

    it('should block cross-origin browser requests to /cli/* via Sec-Fetch-Site', async () => {
        const logger = createFileLogger()
        server = await startPlayWriterCDPRelayServer({ port: TEST_PORT, logger })

        // cross-site browser request → 403
        const crossSite = await httpRequest({
            path: '/cli/execute',
            headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
        })
        expect(crossSite.status).toBe(403)

        // same-site but not same-origin → 403
        const sameSite = await httpRequest({
            path: '/cli/execute',
            headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-site' },
        })
        expect(sameSite.status).toBe(403)
    })

    it('should block cross-origin browser requests to /recording/* via Sec-Fetch-Site', async () => {
        const logger = createFileLogger()
        server = await startPlayWriterCDPRelayServer({ port: TEST_PORT, logger })

        const res = await httpRequest({
            path: '/recording/status',
            method: 'GET',
            headers: { 'Sec-Fetch-Site': 'cross-site' },
        })
        expect(res.status).toBe(403)
    })

    it('should block POST with non-JSON Content-Type (text/plain bypass)', async () => {
        const logger = createFileLogger()
        server = await startPlayWriterCDPRelayServer({ port: TEST_PORT, logger })

        // text/plain is the classic CORS preflight bypass
        const textPlain = await httpRequest({
            path: '/cli/execute',
            headers: { 'Content-Type': 'text/plain' },
        })
        expect(textPlain.status).toBe(415)

        // form-urlencoded is another simple request type
        const formData = await httpRequest({
            path: '/cli/execute',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
        expect(formData.status).toBe(415)

        // missing Content-Type entirely
        const noContentType = await httpRequest({
            path: '/cli/execute',
            headers: {},
        })
        expect(noContentType.status).toBe(415)
    })

    it('should allow requests without Sec-Fetch-Site (Node.js/CLI clients)', async () => {
        const logger = createFileLogger()
        server = await startPlayWriterCDPRelayServer({ port: TEST_PORT, logger })

        // Node.js clients don't send Sec-Fetch-Site, only Content-Type: application/json.
        // Request should pass the middleware (will 404 because no session exists, which is fine).
        const res = await httpRequest({
            path: '/cli/execute',
            headers: { 'Content-Type': 'application/json' },
        })
        // 404 = passed middleware, session just doesn't exist
        expect(res.status).toBe(404)
    })

    it('should allow same-origin browser requests', async () => {
        const logger = createFileLogger()
        server = await startPlayWriterCDPRelayServer({ port: TEST_PORT, logger })

        const res = await httpRequest({
            path: '/cli/execute',
            headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
        })
        // 404 = passed middleware
        expect(res.status).toBe(404)
    })

    it('should enforce token on /cli/* and /recording/* when token mode is enabled', async () => {
        const secretToken = 'test-secret-token'
        const logger = createFileLogger()
        server = await startPlayWriterCDPRelayServer({ port: TEST_PORT, token: secretToken, logger })

        // No token → 401
        const noToken = await httpRequest({
            path: '/cli/sessions',
            method: 'GET',
            headers: {},
        })
        expect(noToken.status).toBe(401)

        // Wrong token → 401
        const wrongToken = await httpRequest({
            path: '/cli/sessions',
            method: 'GET',
            headers: { 'Authorization': 'Bearer wrong-token' },
        })
        expect(wrongToken.status).toBe(401)

        // Correct token via Authorization header → pass middleware
        const bearerOk = await httpRequest({
            path: '/cli/sessions',
            method: 'GET',
            headers: { 'Authorization': `Bearer ${secretToken}` },
        })
        expect(bearerOk.status).toBe(200)

        // Correct token via query param → pass middleware
        const queryOk = await fetch(
            `http://127.0.0.1:${TEST_PORT}/cli/sessions?token=${secretToken}`,
        )
        expect(queryOk.status).toBe(200)

        // Token also enforced on /recording/*
        const recordingNoToken = await httpRequest({
            path: '/recording/status',
            method: 'GET',
            headers: {},
        })
        expect(recordingNoToken.status).toBe(401)

        const recordingWithToken = await httpRequest({
            path: '/recording/status',
            method: 'GET',
            headers: { 'Authorization': `Bearer ${secretToken}` },
        })
        expect(recordingWithToken.status).toBe(200)
    })

    it('should not require token on /cli/* when no token is configured', async () => {
        const logger = createFileLogger()
        server = await startPlayWriterCDPRelayServer({ port: TEST_PORT, logger })

        // Without token mode, /cli/sessions should work with just proper headers
        const res = await httpRequest({
            path: '/cli/sessions',
            method: 'GET',
            headers: {},
        })
        expect(res.status).toBe(200)
    })
})
