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

      if (id.includes('/node_modules/@earendil-works/pi-ai/dist/utils/sanitize-unicode.js')) {
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

      if (
        id.includes(
          '/node_modules/@earendil-works/pi-web-ui/dist/components/ThinkingBlock.js',
        )
      ) {
        next = next.replace(
          '${this.isExpanded ? html `<markdown-block .content=${this.content} .isThinking=${true}></markdown-block>` : ""}',
          '${this.isExpanded ? this.isStreaming ? html `<pre style="margin: 0.25rem 0 0; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; font-family: inherit; font-size: 0.875rem; line-height: 1.6; color: var(--muted-foreground); font-style: italic;">${this.content}</pre>` : html `<markdown-block .content=${this.content} .isThinking=${true}></markdown-block>` : ""}',
        )
      }

      if (id.includes('/node_modules/formdata-polyfill/')) {
        const normalizeLineBreakReplacer =
          "(_match, prefix) => prefix === undefined ? '\\r\\n' : `${prefix}\\r\\n`"
        next = next.replace(
          /(\b(?:value|v)\.replace\()\/\\r\(\?!\\n\)\|\(\?<!\\r\)\\n\/g\s*,\s*(['"])\\r\\n\2\)/g,
          (_match, prefix: string) =>
            `${prefix}/\\r(?!\\n)|(^|[^\\r])\\n/g, ${normalizeLineBreakReplacer})`,
        )
      }

      // remark-gfm email autolink uses lookbehind + unicode properties; findEmail()
      // already validates the preceding character via previous().
      if (id.includes('/node_modules/mdast-util-gfm-autolink-literal/')) {
        next = next.replaceAll(
          '[/(?<=^|\\s|\\p{P}|\\p{S})([-.\\w+]+)@([-\\w]+(?:\\.[-\\w]+)+)/gu, findEmail]',
          String.raw`[/([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/g, findEmail]`,
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
        'node_modules/@earendil-works/pi-tui/node_modules/marked/lib/marked.esm.js',
      ),
    },
  },
  server: {
    fs: { allow: [workspaceRoot] },
  },
})
