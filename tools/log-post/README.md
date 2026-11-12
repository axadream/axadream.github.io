# log-post

Claude skill plus CLI that posts one practice-log entry to alepax.com
(`content/log/` on `axadream/axadream.github.io`, branch `main`) through the
GitHub Contents API. Nothing is sent without `--yes`.

## Files

- `post.mjs` - standalone Node 18+ CLI (node: builtins only)
- `SKILL.md` - instructions for Claude
- `log-entry.schema.json` - must stay identical to `schema/log-entry.schema.json` (a test enforces this)
- `install.ps1` - installer

## Install

Run `tools/log-post/install.ps1` from the repo root. It copies the files to
`~/.claude/skills/log-post/` and creates `~/.alepax-log/`.

## Config (`~/.alepax-log/`, override with `ALEPAX_LOG_HOME`)

- `allowed-projects.txt`: one absolute directory per line; `#` comments. The
  `--cwd` (default: current dir) must equal or sit under one of them.
  Example: `C:\Users\Alex\Desktop\Diverse\VSCode\alepax`
- `deny-terms.txt`: one term per line, case-insensitive; any match in any field refuses.
- `pending/`: queued entries (written on network failure).

Token: `$env:ALEPAX_LOG_TOKEN = '<token>'` (fine-grained PAT, repo axadream.github.io, Contents read/write, 90 days). Never stored.

## CLI

| Flag | Meaning |
|---|---|
| `--text --tag` | required entry text (max 300) and tag |
| `--minutes --link --project --draft` | optional fields |
| `--ts` | ISO 8601 with offset (default: now, local offset) |
| `--cwd` | directory checked against the allowlist |
| `--dry` | preview, exit 0, no token or network |
| `--yes` | really post (needs token) |
| `--flush` | retry `pending/` |
| `--json` | machine output `{ ok, entry, name, file, errors }` |

Exit codes: 0 ok, 1 API 4xx, 2 queued/offline, 3 preview only, 4 refused, 5 token missing.

## Examples

    node post.mjs --dry --text "Rebuilt the loop" --tag "Manual Code"
    node post.mjs --text "Rebuilt the loop" --tag "Manual Code" --minutes 25
    node post.mjs --text "Rebuilt the loop" --tag "Manual Code" --minutes 25 --yes --ts 2026-11-12T21:03:05+01:00
    node post.mjs --flush
