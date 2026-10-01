# pr-review-radar

Local-first dashboard for driving AI code review across your team's open pull requests.

Today the loop is manual: prompt an AI for a summary of every open PR, request reviews on the ones
missing them, re-request on the ones that moved — then re-run the whole prompt to find out what
changed. This app keeps that board live instead.

- One board of every PR matching your GitHub search, grouped by what it needs next.
- Buttons to request an AI review or re-review, run locally through your own `claude` CLI.
- Preview and edit before anything is posted; nothing reaches GitHub without your click.
- Background polling re-evaluates only the PRs that actually changed.

Runs entirely on your machine with your own credentials. Teammates clone it and use theirs.

**Status**: specification complete, implementation pending. Built with
[GitHub Spec Kit](https://github.com/github/spec-kit).

## Specification

| Document | What's in it |
|---|---|
| [Constitution](.specify/memory/constitution.md) | Five non-negotiable principles |
| [Spec](specs/001-pr-review-radar/spec.md) | User stories, 45 functional requirements, success criteria |
| [Plan](specs/001-pr-review-radar/plan.md) | Stack, structure, constitution gate check |
| [Research](specs/001-pr-review-radar/research.md) | Ten technical decisions with rejected alternatives |
| [Data model](specs/001-pr-review-radar/data-model.md) | Entities, schema, derived status rules |
| [HTTP API](specs/001-pr-review-radar/contracts/http-api.md) | Routes and SSE event stream |
| [ChangeSource](specs/001-pr-review-radar/contracts/change-source.md) | The seam that makes webhooks additive |
| [Quickstart](specs/001-pr-review-radar/quickstart.md) | Prerequisites and the daily loop |
| [Tasks](specs/001-pr-review-radar/tasks.md) | 69 tasks, grouped by user story |
