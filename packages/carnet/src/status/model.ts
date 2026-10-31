export const AGENT_STATUSES = [
  "running",
  "discussing",
  "answer",
  "review",
  "apply",
  "test",
  "commit",
  "branch",
  "closed",
] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const USER_ACTION_STATUSES = [
  "discussing",
  "answer",
  "review",
  "apply",
  "test",
  "commit",
  "branch",
] as const;

export type UserActionStatus = (typeof USER_ACTION_STATUSES)[number];

export const EMOJI: Record<Exclude<AgentStatus, "closed">, string> = {
  running: "⏳",
  discussing: "💬",
  answer: "❓",
  review: "👀",
  apply: "📥",
  test: "🧪",
  commit: "✅",
  branch: "🌿",
};

export const MAIN_WORKING_EMOJI = "⚙️";

export const LEGEND =
  "⚙️ main working · 💬 discussing · ❓ answer · 👀 review · 📥 apply · 🧪 test · ✅ commit · 🌿 branch · ⏳ running";

export function isAgentStatus(value: unknown): value is AgentStatus {
  return typeof value === "string" && (AGENT_STATUSES as readonly string[]).includes(value);
}

export function isUserActionStatus(value: unknown): value is UserActionStatus {
  return typeof value === "string" && (USER_ACTION_STATUSES as readonly string[]).includes(value);
}
