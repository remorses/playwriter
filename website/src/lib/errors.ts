import { captureException, flush, init } from 'sentries'

init({
  dsn: 'https://3e3f1075fec9ee2de1e0f79026b5f734@o4508014272446464.ingest.de.sentry.io/4508014292697168',
  integrations: [],
  tracesSampleRate: 0.01,
  profilesSampleRate: 0.01,
  beforeSend(event) {
    if (process.env.NODE_ENV === 'development') {
      return null
    }
    if (process.env.BYTECODE_RUN) {
      return null
    }
    if (event?.['name'] === 'AbortError') {
      return null
    }

    return event
  },
})

export async function notifyError(error: any, msg?: string) {
  console.error(msg, error)
  captureException(error, { extra: { msg } })
  await flush(1000)
}

export class AppError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppError'
  }
}
