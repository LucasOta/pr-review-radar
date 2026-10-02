# config/

Server-side settings for **your** machine. `config.json` is gitignored; only
`config.example.json` is committed.

Copy it if you want to change a default:

```bash
cp config/config.example.json config/config.json
```

| Key | Default | What it does |
|---|---|---|
| `refreshIntervalMs` | `60000` | How often the board polls GitHub. Minimum 10000. |
| `maxConcurrentRuns` | `3` | How many `claude` subprocesses may run at once. |
| `runTimeoutMs` | `600000` | How long one review may take before it is killed. |
| `maxDiffBytes` | `400000` | Diffs above this fail the run instead of being silently truncated. |
| `reviewPromptPath` | `prompts/review.md` | The review instruction. Edit the file, or point at your own. |
| `rereviewPromptPath` | `prompts/re-review.md` | The re-review instruction. |
| `port` | `4317` | Local port. The server always binds `127.0.0.1`. |
| `includeDraftsInBulk` | `false` | Whether group actions include draft pull requests. |

**Your search query is not here.** It lives in your browser
(`localStorage["pr-review-radar:query"]`) so that a repository shared with your team carries
nobody's query. Set it in the UI.

**Your GitHub token is not here either.** It is read at startup from `GITHUB_TOKEN` or
`gh auth token` and held in memory only.
