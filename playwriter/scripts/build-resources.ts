/**
 * Generates markdown resource files for the MCP at build time.
 * 
 * These files are written to:
 * - playwriter/dist/ - for the MCP to read at runtime
 * - website/public/ - for hosting on playwriter.dev
 * 
 * Source of truth:
 * - playwriter/src/skill.md - manually edited, contains full docs including CLI usage
 * 
 * Generated files:
 * - playwriter/dist/prompt.md - MCP prompt (skill.md minus CLI sections)
 * - website/public/SKILL.md - full copy for playwriter.dev/SKILL.md
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dedent from 'string-dedent'
import { Lexer, type Token, type Tokens } from 'marked'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const playwriterDir = path.join(__dirname, '..')
const distDir = path.join(playwriterDir, 'dist')
const websitePublicDir = path.join(playwriterDir, '..', 'website', 'public', 'resources')

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(playwriterDir, relativePath), 'utf-8')
}

function writeToDestinations(filename: string, content: string) {
  ensureDir(distDir)
  ensureDir(websitePublicDir)
  
  const distPath = path.join(distDir, filename)
  const websitePath = path.join(websitePublicDir, filename)
  
  fs.writeFileSync(distPath, content, 'utf-8')
  fs.writeFileSync(websitePath, content, 'utf-8')
  
  console.log(`Generated ${filename}`)
}

function cleanTypes(typesContent: string): string {
  return typesContent
    .replace(/\/\/# sourceMappingURL=.*$/gm, '')
    .trim()
}

function buildDebuggerApi() {
  const debuggerTypes = cleanTypes(readFile('dist/debugger.d.ts'))
  const debuggerExamples = readFile('src/debugger-examples.ts')
  
  const content = dedent`
    # Debugger API Reference

    ## Types

    \`\`\`ts
    ${debuggerTypes}
    \`\`\`

    ## Examples

    \`\`\`ts
    ${debuggerExamples}
    \`\`\`
  `
  
  writeToDestinations('debugger-api.md', content)
}

function buildEditorApi() {
  const editorTypes = cleanTypes(readFile('dist/editor.d.ts'))
  const editorExamples = readFile('src/editor-examples.ts')
  
  const content = dedent`
    # Editor API Reference

    The Editor class provides a Claude Code-like interface for viewing and editing web page scripts at runtime.

    ## Types

    \`\`\`ts
    ${editorTypes}
    \`\`\`

    ## Examples

    \`\`\`ts
    ${editorExamples}
    \`\`\`
  `
  
  writeToDestinations('editor-api.md', content)
}

function buildStylesApi() {
  const stylesTypes = cleanTypes(readFile('dist/styles.d.ts'))
  const stylesExamples = readFile('src/styles-examples.ts')
  
  const content = dedent`
    # Styles API Reference

    The getStylesForLocator function inspects CSS styles applied to an element, similar to browser DevTools "Styles" panel.

    ## Types

    \`\`\`ts
    ${stylesTypes}
    \`\`\`

    ## Examples

    \`\`\`ts
    ${stylesExamples}
    \`\`\`
  `
  
  writeToDestinations('styles-api.md', content)
}

/**
 * Removes CLI-related sections from skill.md to create prompt.md for the MCP.
 * 
 * Sections removed:
 * - "## CLI Usage" section and all its subsections
 */
function stripCliSectionsFromSkill(skillContent: string): string {
  // Parse markdown tokens
  const tokens = Lexer.lex(skillContent)
  
  // Filter out CLI Usage section and its subsections
  const filteredTokens: Token[] = []
  let skipUntilLevel: number | null = null
  
  for (const token of tokens) {
    if (token.type === 'heading') {
      const heading = token as Tokens.Heading
      // Check if we should start skipping (CLI Usage section)
      if (heading.depth === 2 && heading.text === 'CLI Usage') {
        skipUntilLevel = 2
        continue
      }
      // Check if we should stop skipping (next h2 section)
      if (skipUntilLevel !== null && heading.depth <= skipUntilLevel) {
        skipUntilLevel = null
      }
    }
    
    if (skipUntilLevel === null) {
      filteredTokens.push(token)
    }
  }
  
  // Reconstruct markdown from tokens
  return filteredTokens.map((token) => { return token.raw }).join('').trim() + '\n'
}

function buildPromptFromSkill() {
  // Read skill.md as source of truth
  const skillPath = path.join(playwriterDir, 'src', 'skill.md')
  const skillContent = fs.readFileSync(skillPath, 'utf-8')
  
  // Generate prompt.md for MCP (without CLI sections)
  const promptContent = stripCliSectionsFromSkill(skillContent)
  const distPromptPath = path.join(distDir, 'prompt.md')
  fs.writeFileSync(distPromptPath, promptContent, 'utf-8')
  console.log('Generated playwriter/dist/prompt.md (from skill.md)')
  
  // Copy full skill.md to website/public/ for hosting at playwriter.dev/SKILL.md
  const websitePublicRoot = path.join(playwriterDir, '..', 'website', 'public')
  ensureDir(websitePublicRoot)
  fs.writeFileSync(path.join(websitePublicRoot, 'SKILL.md'), skillContent, 'utf-8')
  console.log('Generated website/public/SKILL.md')
}

// Run all builds
buildDebuggerApi()
buildEditorApi()
buildStylesApi()
buildPromptFromSkill()

console.log('Resource files generated successfully')
