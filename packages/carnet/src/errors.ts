export type CarnetErrorCode =
  | "NO_GROUP"
  | "GROUP_EXISTS"
  | "REPO_NOT_FOUND"
  | "NO_SESSION"
  | "SESSION_NOT_FOUND"
  | "SESSION_NAME_TAKEN"
  | "SESSION_MERGE_INVALID"
  | "AGENT_EXISTS"
  | "AGENT_NOT_FOUND"
  | "INVALID_STATUS"
  | "INVALID_EVENT_TYPE"
  | "TABLE_STATUS_WITH_MAIN_WORKING";

export class CarnetError extends Error {
  constructor(
    readonly code: CarnetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CarnetError";
  }
}
