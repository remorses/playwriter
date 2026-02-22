import { page, getCDPSession, createEditor, console } from './debugger-examples-types.js'

// Example: List available scripts
async function listScripts() {
  const cdp = await getCDPSession({ page })
  const editor = createEditor({ cdp })
  await editor.enable()

  const scripts = editor.list({ pattern: /app/ })
  console.log(scripts)
}

// Example: Read a script with line numbers
async function readScript() {
  const cdp = await getCDPSession({ page })
  const editor = createEditor({ cdp })
  await editor.enable()

  const { content, totalLines } = await editor.read({
    url: 'https://example.com/app.js',
  })
  console.log('Total lines:', totalLines)
  console.log(content)

  const { content: partial } = await editor.read({
    url: 'https://example.com/app.js',
    offset: 100,
    limit: 50,
  })
  console.log(partial)
}

// Example: Edit a script (exact string replacement)
async function editScript() {
  const cdp = await getCDPSession({ page })
  const editor = createEditor({ cdp })
  await editor.enable()

  await editor.edit({
    url: 'https://example.com/app.js',
    oldString: 'const DEBUG = false',
    newString: 'const DEBUG = true',
  })

  const dryRunResult = await editor.edit({
    url: 'https://example.com/app.js',
    oldString: 'old code',
    newString: 'new code',
    dryRun: true,
  })
  console.log('Dry run result:', dryRunResult)
}

// Example: Search across all scripts
async function searchScripts() {
  const cdp = await getCDPSession({ page })
  const editor = createEditor({ cdp })
  await editor.enable()

  const matches = await editor.grep({ regex: /console\.log/ })
  console.log(matches)

  const todoMatches = await editor.grep({
    regex: /TODO|FIXME/i,
    pattern: /app/,
  })
  console.log(todoMatches)
}

// Example: Write entire script content
async function writeScript() {
  const cdp = await getCDPSession({ page })
  const editor = createEditor({ cdp })
  await editor.enable()

  const { content } = await editor.read({ url: 'https://example.com/app.js' })
  const newContent = content.replace(/console\.log/g, 'console.debug')

  await editor.write({
    url: 'https://example.com/app.js',
    content: newContent,
  })
}

// Example: Edit an inline script (scripts without URL get inline://{id} URLs)
async function editInlineScript() {
  const cdp = await getCDPSession({ page })
  const editor = createEditor({ cdp })
  await editor.enable()

  const matches = await editor.grep({ regex: /myFunction/ })
  if (matches.length > 0) {
    const { url } = matches[0]
    console.log('Found in:', url)

    await editor.edit({
      url,
      oldString: 'return false',
      newString: 'return true',
    })
  }
}

// Example: List and read CSS stylesheets
async function readStylesheet() {
  const cdp = await getCDPSession({ page })
  const editor = createEditor({ cdp })
  await editor.enable()

  const stylesheets = await editor.list({ pattern: /\.css/ })
  console.log('Stylesheets:', stylesheets)

  if (stylesheets.length > 0) {
    const { content, totalLines } = await editor.read({
      url: stylesheets[0],
    })
    console.log('Total lines:', totalLines)
    console.log(content)
  }
}

// Example: Edit a CSS stylesheet
async function editStylesheet() {
  const cdp = await getCDPSession({ page })
  const editor = createEditor({ cdp })
  await editor.enable()

  await editor.edit({
    url: 'https://example.com/styles.css',
    oldString: 'color: red',
    newString: 'color: blue',
  })
}

// Example: Search CSS for specific properties
async function searchStyles() {
  const cdp = await getCDPSession({ page })
  const editor = createEditor({ cdp })
  await editor.enable()

  const matches = await editor.grep({
    regex: /background-color/,
    pattern: /\.css/,
  })
  console.log(matches)
}

export {
  listScripts,
  readScript,
  editScript,
  searchScripts,
  writeScript,
  editInlineScript,
  readStylesheet,
  editStylesheet,
  searchStyles,
}
