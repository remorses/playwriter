import { createExtensionContext } from '../src/extension/extensionContextFactory'

async function main() {
    const controller = new AbortController()
    const { browserContext, close } = await createExtensionContext(
        controller.signal,
    )


}
