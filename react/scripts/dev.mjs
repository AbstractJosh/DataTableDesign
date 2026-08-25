/**
 * `npm run dev` — the API server and the Vite dev server, together.
 *
 * The demo's records come from SQLite now, so starting Vite on its own gives a
 * screen with an error strip where the table should be. Two terminals would
 * work; a launcher that dies properly is one fewer thing to explain.
 *
 * No `concurrently`, and not because it is a big dependency — because it is a
 * dependency in a package whose whole claim is that it has none, for something
 * that is forty lines of `child_process`.
 *
 * Both children are spawned through `process.execPath` and a resolved script
 * path rather than through a shell. Windows is the reason: `vite` on PATH is a
 * `.cmd` shim, `shell: true` would be needed to run it, and a shell in the
 * middle swallows the signal — Ctrl-C would leave both servers running with
 * their ports held.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))

const children = []

/**
 * The API server already tags its own lines `[api]`, because it is worth having
 * when it is run on its own. Adding the tag again here would print it twice, so
 * a line that already carries it is passed through untouched.
 */
const label = (name, line) => (line.startsWith(name) ? `${line}\n` : `${name} ${line}\n`)

function start(name, script, args = []) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })

  const prefix = (stream, target) => {
    let carry = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      const lines = (carry + chunk).split('\n')
      // A chunk rarely ends on a line break; the remainder waits for the rest
      // of its line rather than being printed with a prefix in the middle.
      carry = lines.pop() ?? ''
      for (const line of lines) target.write(label(name, line))
    })
    stream.on('end', () => {
      if (carry) target.write(label(name, carry))
    })
  }

  prefix(child.stdout, process.stdout)
  prefix(child.stderr, process.stderr)

  child.on('exit', (code, signal) => {
    if (stopping) return
    console.log(`${name} exited (${signal ?? code}) — stopping the other`)
    stop(code ?? 1)
  })

  children.push(child)
  return child
}

let stopping = false

function stop(code) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    // SIGTERM so the API server closes its database: WAL only folds its
    // sidecar back into the file on a clean close.
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(code), 300).unref()
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

/**
 * Vite's own declaration of where its CLI is, rather than a guessed path.
 *
 * `require.resolve('vite/bin/vite.js')` looks like the obvious way and is not:
 * the package's `exports` map does not list `./bin/*`, so Node refuses it. Only
 * `./package.json` is exported — which is enough, because `bin.vite` inside it
 * is the path, and reading it there survives Vite moving the file.
 */
function viteCli() {
  const manifest = require.resolve('vite/package.json')
  const { bin } = require(manifest)
  const relative = typeof bin === 'string' ? bin : bin.vite
  return fileURLToPath(new URL(relative, pathToFileURL(manifest)))
}

start('[api]', fileURLToPath(new URL('../server/index.ts', import.meta.url)))
start('[web]', viteCli())
