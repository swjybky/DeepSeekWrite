import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webRoot = path.dirname(fileURLToPath(import.meta.url))

function safariRegexCompatPlugin(): Plugin {
  return {
    name: 'write-claw-safari-regex-compat',
    transform(code, id) {
      let next = code

      if (
        id.includes('/node_modules/openai/internal/utils/path') ||
        id.includes('/node_modules/@anthropic-ai/sdk/internal/utils/path')
      ) {
        next = next.replace(
          /const invalidSegmentPattern = \/\(\?<=\^\|\\\/\)\(\?:\\\.\|%2e\)\{1,2\}\(\?=\\\/\|\$\)\/gi;/g,
          'const invalidSegmentPattern = /(^|\\/)(?:\\.|%2e){1,2}(?=\\/|$)/gi;',
        )
      }

      if (
        id.includes('/node_modules/zod-to-json-schema/') ||
        id.includes('/node_modules/openai/_vendor/zod-to-json-schema/')
      ) {
        next = next.replaceAll(
          'pattern += `(^|(?<=[\\r\\n]))`;',
          'pattern += `(^|[\\r\\n])`;',
        )
      }

      if (id.includes('/node_modules/@mariozechner/pi-ai/dist/utils/sanitize-unicode.js')) {
        next = next.replace(
          /export function sanitizeSurrogates\(text\) \{[\s\S]*?return text\.replace\([^;]+;\n\}/,
          `export function sanitizeSurrogates(text) {
    let result = "";
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = text.charCodeAt(index + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                result += text[index] + text[index + 1];
                index++;
            }
            continue;
        }
        if (code >= 0xdc00 && code <= 0xdfff) continue;
        result += text[index];
    }
    return result;
}`,
        )
      }

      if (id.includes('/node_modules/formdata-polyfill/')) {
        next = next.replace(
          /value\.replace\(\/\\r\(\?!\\n\)\|\(\?<!\\r\)\\n\/g, '([^']*)'\)/g,
          "value.replace(/\\r(?!\\n)|(^|[^\\r])\\n/g, (_match, prefix) => `${prefix}$1`)",
        )
        next = next.replace(
          /v\.replace\(\/\\r\(\?!\\n\)\|\(\?<!\\r\)\\n\/g,'([^']*)'\)/g,
          "v.replace(/\\r(?!\\n)|(^|[^\\r])\\n/g,(_match,prefix)=>`${prefix}$1`)",
        )
      }

      return next === code ? null : next
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [safariRegexCompatPlugin(), react()],
  base: './',
  build: {
    target: ['es2020', 'safari14'],
    cssTarget: 'safari14',
  },
  resolve: {
    alias: {
      '@lmstudio/sdk': path.resolve(webRoot, 'src/vendor/lmstudio-sdk-browser.ts'),
      marked: path.resolve(
        webRoot,
        'node_modules/@mariozechner/pi-tui/node_modules/marked/lib/marked.esm.js',
      ),
    },
  },
  server: {
    fs: { allow: [workspaceRoot] },
  },
})
