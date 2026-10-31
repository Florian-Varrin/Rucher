# Rucher Core + TUI — Spec

## Vision

Rucher is a TUI that drives several Claude Code agents organized in named sessions: a main agent you talk to, and sub-agents launched on demand, persistent, that you handle when you want.

Problems solved compared to native Claude Code:

- Sub-agents disappear when they finish.
- Their results all arrive at once in the main thread.
- No persistent view of the agents or their status.
- Countless anonymous sessions: you never know where to resume. No notion of a group of repos, nor of rebuildable context.

Target: personal use first, open source next. Stack: TypeScript, Claude Agent SDK, Ink.

Starting brick: [Carnet](carnet-spec.md) (library, MCP server and CLI for statuses, sessions and journal).

## Concepts

Three levels: a group contains sessions, a session contains a main agent and sub-agents. A session corresponds to a feature, to a smaller task, or to a durable reused thread (for example "small ui changes").

| Concept    | Role                                                                           | Fields                                                                                              |
| ---------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Group      | Set of related repos (for example MyCity, API Craft), with shared instructions | name, instructions, repos[]                                                                         |
| Session    | Named unit of work, attached to a group: feature, small task or durable thread | name, group, type (persistent / temporary), repos involved, branch?, status, journal, last activity |
| Main agent | Main agent of the session, the one you talk to by default                      | session_id, permission mode                                                                         |
| Sub-agent  | Agent launched by the user for a precise task, persistent                      | name, session, session_id, parent_id, task, status, permission mode, worktree?                      |

Rules:

- Only the user launches sub-agents. The main agent can propose them, the user validates.
- A sub-agent is created by forking the main agent's session: it inherits its whole context.
- A sub-agent stays available after finishing, until the user closes it.

### Session management

The goal is a small set of sessions you know how to resume, instead of the hundreds of anonymous Claude Code sessions.

| Type       | Use                                                               | End of life                            |
| ---------- | ----------------------------------------------------------------- | -------------------------------------- |
| Persistent | Feature in progress or durable reused thread ("small ui changes") | Kept until the user drops it           |
| Temporary  | One-off task launched at startup                                  | Cleaned up automatically when finished |

- At startup: list of the group's persistent sessions (name, last activity, waiting agents), resume in one choice, or create a new session.
- A temporary session can be promoted to persistent before it ends.
- Dropping a session: closes its agents, archives its journal, removes the session from the list.
- A persistent session that grows too much can be compacted or restart fresh from its journal.

## UX

One chat window and one input field; routing is done with `@`.

**Layout**

- Main area: the session chat.
- Side panel: list of sub-agents with name, status and duration, waiting agents on top.
- Permission request queue, separate from the chat.

**Message routing**

| Input                  | Recipient          |
| ---------------------- | ------------------ |
| `message`              | main agent         |
| `@banner message`      | one sub-agent      |
| `@banner @dto message` | several sub-agents |
| `@all message`         | all sub-agents     |

**Displaying answers**

- A sub-agent answer appears in the main flow as a folded line (`banner finished`, `dto has a question`), expandable.
- Focus mode (`/focus banner` or selection in the list): the chat shows the agent's full conversation and messages go to it without `@`. `Esc` returns to the main agent.
- Hand-off: a key opens an idle sub-agent in the real `claude` (`claude --resume <id>`), for complex sessions.

**Traceability on the main agent side**

The main agent keeps track of direct exchanges with sub-agents. Traces are queued and prepended to the next message sent to the main agent, to avoid triggering a useless turn:

```
[Notes since your last message]
- Flo → banner: keep the cache
[Message from Flo]
...
```

## Agent lifecycle

Statuses are derived from SDK events, never guessed.

| Status             | Trigger                                                                    | Display                  |
| ------------------ | -------------------------------------------------------------------------- | ------------------------ |
| running            | turn in progress                                                           | in progress              |
| waiting_permission | call to `canUseTool`                                                       | in the permission queue  |
| waiting_input      | end of turn with an open question (`ask_parent` tool or detected question) | top of the list          |
| done               | end of turn without question                                               | finished, not handled    |
| seen               | the user opened the agent in focus                                         | finished, handled        |
| error              | SDK or process error                                                       | in red, with the message |
| closed             | closed by the user                                                         | archived, off the list   |

Actions on an agent: send a message, interrupt the current turn, change the permission mode, open in `claude`, close. `/next` command: jumps to the oldest unhandled `done` or `waiting_input` agent.

## Permissions

Each agent has its own permission mode, changeable at any time.

- SDK modes: `default`, `acceptEdits`, `plan`, `bypassPermissions` (`auto` if exposed by the SDK, to verify).
- Mode at creation: inherited from the group config, overridable per agent.
- Change during a session via `setPermissionMode`, with a `Shift+Tab`-like shortcut on the selected agent.
- Requests received through `canUseTool`, stacked in a global queue: agent, tool, parameters, then accept / refuse / always accept for this agent.
- A pending request blocks only its agent, never the chat.

## Context and journal

A session's context is assembled by the tool, then maintained by a curated journal that allows rebuilding it.

**Loading at session creation or resume**

1. Group instructions (short).
2. Map of the repos involved: working directory + `additionalDirectories`.
3. The session journal, if it exists (resume).
4. The repos' `CLAUDE.md` files stay loaded by Claude Code itself.

**Journal**

- Two distinct layers: the raw transcript (kept by the SDK) and the curated journal (decisions, files touched, state, next steps).
- Fed by the agents through internal MCP tools: `log_decision`, `log_status`.
- Uses: resume a session in a fresh SDK session without the full history, re-inject the essentials after a compaction.
- Compaction of the journal itself: old entries are summarized.

**Guardrails**

- Token budget at load time: group instructions and journal summarized, details in files read on demand.
- One source of truth per piece of information: group and session in the tool, code conventions in the repos' `CLAUDE.md`.

## Technical architecture

One Node process: the Ink TUI, an orchestrator, and one SDK session per agent. No tmux.

| Module             | Responsibility                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| UI (Ink)           | chat, agent list, permission queue, focus, `@` routing                                                         |
| Orchestrator       | registry of groups / sessions / agents, cleanup of temporary sessions, message routing, main agent trace queue |
| AgentRunner        | one instance per agent: SDK session (creation, fork, resume), event stream, interruption                       |
| Permissions        | `canUseTool` callback, global queue, "always accept" rules                                                     |
| Internal MCP tools | `report`, `ask_parent`, `log_decision`, `log_status`, exposed in process through the SDK                       |
| Storage            | persistent state on disk (Carnet database), reloaded at startup                                                |
| Hand-off           | runs `claude --resume <id>` for an idle agent                                                                  |

**Storage**

- Global: `~/.rucher/` (config, groups).
- Per group: the Carnet SQLite database (sessions, agents, events).
- Per session: agent reports in markdown.

**Sessions**

- Main: new SDK session in the folder of the session's main repo.
- Sub-agent: fork of the main agent's session at launch time.
- Worktrees: none by default, opt-in per agent for parallel writing tasks.

**Costs**: tokens and cost per agent and per session, read from the SDK's end-of-turn messages.

### Multiple backends

The orchestrator and the UI only talk to an `AgentBackend` interface and to normalized events, never to the SDKs directly. The MVP only implements Claude; OpenCode comes next.

```ts
interface AgentBackend {
  createSession(opts): Promise<SessionRef>;
  fork(parent: SessionRef): Promise<SessionRef>;
  send(session, message): Promise<void>;
  interrupt(session): Promise<void>;
  setPermissionMode(session, mode): Promise<void>;
  events(session): AsyncIterable<SwarmEvent>;
}
```

Normalized `SwarmEvent`: turn start, text, tool call, permission request, turn end, error, cost.

| Point               | Claude (Agent SDK)             | OpenCode (SDK / HTTP API)                         |
| ------------------- | ------------------------------ | ------------------------------------------------- |
| Transport           | `claude` process + stream-json | HTTP server + SSE                                 |
| Fork                | native (`--fork-session`)      | to verify; otherwise new session + parent summary |
| Modes               | `permissionMode`               | `build` / `plan` agents                           |
| Permissions         | `canUseTool` callback          | events + answer through the API                   |
| Internal tools      | in-process MCP                 | MCP config or plugin                              |
| Costs               | end-of-turn message            | own format, to normalize                          |
| Claude subscription | allowed                        | no, API key or other models                       |

Each session chooses its backend and its model: Claude for a complex feature, a cheaper model through OpenCode for a "small ui changes" thread.

## Anthropic license compliance

The tool always goes through the official `claude` binary via the Agent SDK, with the login done by the user themselves.

- No authentication handling in the tool: it requires `claude` to be installed and logged in (`claude /login`).
- No extraction nor reuse of the OAuth token.
- No hosted version, no requests routed for other users.
- README: the tool uses the user's Claude Code installation and subscription, subject to Anthropic's terms.
- No "Claude" in the project name.
- Billing: the separate SDK credit planned for June 15, 2026 is paused; SDK usage draws from the subscription limits. To watch.

Sources: [Claude Code – Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance), [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540).

## Roadmap

**MVP (weekend prototype)**

- [ ] One session without group: main agent in a given folder
- [ ] Launching a sub-agent by forking the main agent
- [ ] Agent list with statuses
- [ ] `@agent` and `@all` routing, focus mode
- [ ] Sub-agent answers folded in the flow
- [ ] Permission queue through `canUseTool`
- [ ] Named persistent sessions, list at startup, resume after restart
- [ ] `AgentBackend` interface + normalized events, Claude implementation only

**V2**

- [ ] Groups, context loading, auto-cleaned temporary sessions, drop and promotion
- [ ] Curated journal + `log_decision` / `log_status` tools
- [ ] Traces of direct exchanges to the main agent
- [ ] `report` / `ask_parent` tools
- [ ] `/next`, `seen` status
- [ ] Per-agent permission mode, changeable

**V3**

- [ ] Hand-off to `claude --resume`
- [ ] Opt-in worktree per agent
- [ ] Costs per agent and per session
- [ ] OpenCode backend, backend and model choice per session
- [ ] Journal compaction
- [ ] Desktop notifications
- [ ] npm packaging and docs for open source

## Open questions

- [ ] Remote Control: usable on an SDK-driven session, or only through the hand-off?
- [ ] Is the `auto` mode exposed by the SDK?
- [ ] How to detect an open question at end of turn without an `ask_parent` tool?
- [ ] Can a sub-agent be forked from another sub-agent, or only from the main agent?
- [ ] Group config format: YAML/JSON file per group, or interactive command?
- [ ] Behavior if the main agent is compacted: already-forked sub-agents keep the old context, should it be flagged?
