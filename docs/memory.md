# Memory

What a group has learned, shared by every session of the group. For the journal see [sessions.md](sessions.md); for commands, tools and files see [reference.md](reference.md).

## Why

Sessions start blind. The journal records what happened in one session; a new session of the same group does not know that an approach was already tried and failed, that a decision was made, or that a repo hides a trap. Memory is a small set of notes, written through tools, and brought into the group's sessions when they concern the work.

## Three kinds of information

| Kind    | Holds                                | Lifecycle                            | Where                  |
| ------- | ------------------------------------ | ------------------------------------ | ---------------------- |
| State   | where things stand now               | overwritten                          | agents, the table line |
| Journal | what happened, dated                 | append-only                          | events, per session    |
| Memory  | what was learned, decided, ruled out | distilled, short, dropped when wrong | notes, per **group**   |

A journal event is a fact at a date. A note is a living claim: it stays true until someone drops it.

## Notes

| Kind       | Meaning                                   | Example                                                    |
| ---------- | ----------------------------------------- | ---------------------------------------------------------- |
| `learning` | something that works, or a trap in a repo | `[shop-api] the tests need REDIS_URL, even the unit tests` |
| `dead_end` | tried and given up, with the reason       | `sessions on Workers: the cold start breaks the SSR cache` |
| `decision` | a choice made, with the why               | `auth stays in sessions: the SSO partners need cookies`    |

Rules for the text: one claim per note, under 200 characters, readable without context, with its reason. No backticks, no markdown, one line.

A note is **general** (no repo) or tied to **one or more repos** of the group, by their name in `group.json` (the directory name unless set). Two repos of a group cannot share a name, so `rucher group add` refuses a second `shop-api`.

Notes are numbered per group: each group starts at `#1`, and a number always means a note of the current group.

Adding a note very close to an active one of the same kind (same words, mostly) still adds it, and flags the likely duplicate: in the result, and in `rucher notes` (`similar to #1`). Drop one of them, or drop the old one with `replaced_by`.

A dropped note is never deleted: `rucher notes --all` shows it with its reason. Notes and citations outlive the sessions they came from.

## Who writes

Forks never call `note_add`: their report ends with a `## Learnings` section, one candidate note per line (`dead_end [shop-api] <text>`). The main agent records notes once per step, at its end: the `Learnings` of a fork when its work is applied or dropped (a dropped fork is the best source of dead ends), and what it learned itself. Nobody confirms a note: you see them in `rucher status` and correct afterwards with `rucher notes drop`, or `rucher notes add` by hand. The full rules are in the [workflow](workflow.md#memory).

## Citations and weight

An agent cites a note with `note_cite` when the note changed what it did ("avoided the Workers migration thanks to #14"), never for a plain read. The weight of a note is the sum of its citations, one per session, each halved every `RUCHER_MEMORY_HALF_LIFE_DAYS` active days (default 20). An active day is a day at least one session of the group worked, so a group paused for two months keeps its memory intact.

The weight only orders notes inside a kind and feeds `rucher notes --stale`: notes older than 40 active days that were never cited, or whose weight fell close to zero, for you to review. Nothing is ever dropped automatically.

## Commands

```bash
rucher notes                          # active notes, by kind
rucher notes --all                    # with the dropped ones and their reason
rucher notes --kind dead_end --repo shop-api
rucher notes --general                # only the notes without repo
rucher notes show 14                  # the note, its repos, weight and citations
rucher notes --stale                  # to review
rucher notes --md > memory.md         # a view, never read back
rucher notes add dead_end "…" --repo shop-api --repo shop-web
rucher notes drop 14 --reason "…" [--replaced-by 31]
```

## In `rucher status`

Nothing asks you to confirm a note: you see them go by in `rucher status`. Under "Running", a "Notes" section lists what the displayed session added, cited and dropped, most recent first:

```text
Notes
  − #7   dropped   replaced by #31
  + #31  dead_end  similar to #12 · tenant SSR cache: key too wide, leaks between tenants
  ★ #14  cited     avoided the Workers migration
```

`similar to #N` flags a possible duplicate found when the note was added: drop one, or keep both if they differ. Beyond five lines the section folds to one line (`Notes  4 added · 1 cited · 1 dropped · 1 possible duplicate`), and `--all` shows only that line for each session. The section is absent when the session touched no note.

## How notes reach a session

At start (`rucher hook session-start`):

| Source             | Brought in                                                                   |
| ------------------ | ---------------------------------------------------------------------------- |
| `startup`, `clear` | the general notes, and the notes of the session's repo when it starts in one |
| `resume`           | after the resume context, the notes the session already had                  |
| `compact`          | the notes the session already had                                            |

A session started in its group's run directory has no repo yet. A repo's notes come in the first time a tool touches a file of that repo (`rucher hook post-tool-use`, on `Read`, `Edit`, `Write`, `Grep`, `Glob` and `Bash`): the file path, the search path, or the shell's working directory for `Bash` (commands are not parsed). Once per repo and per session; a note shared with a repo already brought in is not repeated. Forks run in their parent's context, so they get nothing of their own.

```text
Rucher memory, repo shop-web (2 notes, note_list for details):

Dead ends
  #14  SSR cache per tenant: key too wide, leaks across tenants
Learnings
  #21  [shop-web] the preview build needs NODE_ENV=production
```

Inside each kind, notes come by weight, newest first on a tie. Each injection stays under `RUCHER_MEMORY_MAX_CHARACTERS` (default 2000), on its own budget, separate from the resume context: learnings are cut first, then decisions, dead ends last, the lowest weight first inside a kind, and the header says how many were left out. Every message also marks the day as active (`active_days`), for the weights.

### Keys in `rucher status --watch`

When the pane is a terminal, `rucher status --watch` reads a few keys for the displayed session (not with `--all`, where only `q` works):

| Key     | Does                                                                              |
| ------- | --------------------------------------------------------------------------------- |
| `n`     | unfold the Notes section (never folded while open), or fold it back               |
| `↑` `↓` | select a note in the unfolded section                                             |
| `enter` | show the note under its line: full text, repos, weight, citations; again to close |
| `esc`   | close the detail, or cancel a drop                                                |
| `d`     | drop the selected note: type the reason, `enter` to drop, `esc` to cancel         |
| `q`     | quit (`ctrl-c` too)                                                               |

The refresh pauses while you type a reason. The drop is recorded for the displayed session. Without a terminal (a pipe, CI) `--watch` stays read-only.

## Coming next

- Notes for sub-agents: a fork that touches a repo first gets that repo's notes too.
