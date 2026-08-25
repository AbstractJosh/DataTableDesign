/**
 * @vitest-environment node
 *
 * The constraint that is easy to break and impossible to notice.
 *
 * Every other test in this folder runs under Vitest, which resolves modules
 * with Vite — extensionless specifiers, `.tsx`, CSS imports, all of it. The
 * server does not: it is started with bare `node server/index.ts`, where type
 * stripping removes the annotations and nothing rewrites the imports. A module
 * that reaches for `./i18n` instead of `./i18n.ts`, or that picks up something
 * with a runtime import of React, passes every test in this repo and then fails
 * to boot.
 *
 * So this file does not import the server. It *spawns* it, the way `npm run
 * dev:api` does, and asserts the process comes up.
 */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Loads one module in a fresh Node process, exactly as the server would. */
function importUnderNode(relative: string): { ok: boolean; stderr: string } {
  const url = pathToFileURL(fileURLToPath(new URL(relative, import.meta.url))).href
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `await import(${JSON.stringify(url)})`],
    // Nothing here starts a server or opens a file — the modules are only
    // loaded, so no database is touched and nothing is seeded.
    { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } },
  )
  return { ok: result.status === 0, stderr: result.stderr ?? '' }
}

describe('the server loads without a bundler', () => {
  it.each([
    ['./db.ts'],
    ['./query.ts'],
    ['./store.ts'],
    ['./http.ts'],
  ])('%s', (module) => {
    const { ok, stderr } = importUnderNode(module)
    expect(stderr, stderr).not.toContain('ERR_MODULE_NOT_FOUND')
    expect(ok).toBe(true)
  })

  it.each([
    ['../src/lib/demoData.ts'],
    ['../src/lib/i18n.ts'],
    ['../src/lib/tableDate.ts'],
    ['../src/lib/types.ts'],
    ['../src/lib/sort.ts'],
  ])('and so does %s, which it reaches into', (module) => {
    expect(importUnderNode(module).ok).toBe(true)
  })
})

/**
 * Stated as a test rather than a comment, because it is the reason
 * `parseTableDate` lives in `tableDate.ts` and the reason `query.ts` keeps its
 * own copy of the column-type table. If this ever starts passing, both of those
 * workarounds can be deleted — and the failure message is where to look.
 */
describe('and cannot load what it deliberately avoids', () => {
  it('filters.ts, which imports i18n without an extension', () => {
    const { ok, stderr } = importUnderNode('../src/lib/filters.ts')
    expect(ok).toBe(false)
    expect(stderr).toContain('ERR_MODULE_NOT_FOUND')
  })
})
