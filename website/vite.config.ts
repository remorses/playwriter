import { holocron } from '@holocron.so/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  clearScreen: false,
  plugins: [holocron({ pagesDir: 'src' })],
})
