import './styles/globals.css'
import { Spiceflow, serveStatic, redirect } from 'spiceflow'
import { Head } from 'spiceflow/react'
import { IndexPage } from './pages/index.js'

export const app = new Spiceflow()
  .use(serveStatic({ root: './public' }))
  .layout('/*', async ({ children }) => {
    return (
      <html lang='en'>
        <Head>
          <Head.Meta charSet='utf-8' />
          <Head.Meta name='viewport' content='width=device-width, initial-scale=1' />
          <link rel='preconnect' href='https://fonts.googleapis.com' />
          <link rel='preconnect' href='https://fonts.gstatic.com' crossOrigin='' />
          <link href='https://rsms.me/inter/inter.css' rel='stylesheet' />
          <link
            href='https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..700;1,6..72,300..700&display=swap'
            rel='stylesheet'
          />
          <link rel='icon' type='image/png' href='/favicon-32.png' sizes='32x32' />
          <link rel='icon' type='image/png' href='/favicon-16.png' sizes='16x16' />
        </Head>
        <body>{children}</body>
      </html>
    )
  })
  .staticPage('/', async () => {
    const title = 'Playwriter - Chrome extension & CLI that lets agents use your real browser'
    const description =
      'Chrome extension and CLI that let your agents control your actual browser. Your logins, extensions, cookies — already there. No headless instance, no bot detection.'
    const image = 'https://playwriter.dev/og-image.png'
    return (
      <>
        <Head>
          <Head.Title>{title}</Head.Title>
          <Head.Meta name='description' content={description} />
          <Head.Meta property='og:title' content={title} />
          <Head.Meta property='og:description' content={description} />
          <Head.Meta property='og:image' content={image} />
          <Head.Meta property='og:image:width' content='1200' />
          <Head.Meta property='og:image:height' content='630' />
          <Head.Meta property='og:type' content='website' />
          <Head.Meta property='og:url' content='https://playwriter.dev' />
          <Head.Meta name='twitter:card' content='summary_large_image' />
          <Head.Meta name='twitter:title' content={title} />
          <Head.Meta name='twitter:description' content={description} />
          <Head.Meta name='twitter:image' content={image} />
        </Head>
        <IndexPage />
      </>
    )
  })
  .get('/github', () => {
    throw redirect('https://github.com/remorses/playwriter')
  })

export type App = typeof app
