# Memory

What a group has learned, shared by every session of the group. For the journal see [sessions.md](sessions.md); for commands, tools and files see [reference.md](reference.md).

## Why

Sessions start blind. The journal records what happened in one session; a new session of the same group does not know that an approach was already tried and failed, that a decision was made, or that a repo hides a trap. Memory is a small set of notes, written through tools, that every session of the group can read.

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

A note is **general** (no repo) or tied to **one or more repos** of the group, by their directory name. Two repos of a group cannot share a directory name, so `rucher group add` refuses a second `shop-api`.

Adding a note very close to an active one of the same kind (same words, mostly) still adds it, and flags the likely duplicate: in the result, and in `rucher notes` (`similar to #1`). Drop one of them, or drop the old one with `replaced_by`.

A dropped note is never deleted: `rucher notes --all` shows it with its reason. Notes and citations outlive the sessions they came from.

## Who writes

The main agent records notes with `note_add` at the end of a step, including the `Learnings` of fork reports. Forks never call `note_add`; they end their report with a `Learnings` section. The human corrects afterwards: `rucher notes drop`, or `rucher notes add` by hand.

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

## Coming next

- Injection: general notes at session start, a repo's notes the first time a session touches that repo.
- A "Notes" section in `rucher status` showing the notes added, cited and dropped in the session, then keys in `--watch` to read and drop them.
