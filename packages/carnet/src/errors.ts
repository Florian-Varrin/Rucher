export type CarnetErrorCode =
  | 'NO_GROUP'
  | 'GROUP_AMBIGUOUS'
  | 'GROUP_EXISTS'
  | 'GROUP_NOT_FOUND'
  | 'GROUP_NAME_INVALID'
  | 'REPO_NOT_FOUND'
  | 'REPO_NAME_TAKEN'
  | 'NOTE_NOT_FOUND'
  | 'INVALID_NOTE'
  | 'UNKNOWN_HOST'
  | 'NO_SESSION'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_AMBIGUOUS'
  | 'SESSION_NAME_TAKEN'
  | 'SESSION_NAME_REQUIRED'
  | 'SESSION_RUNNING'
  | 'SESSION_KIND_INVALID'
  | 'SESSION_MERGE_INVALID'
  | 'SESSION_EXISTS'
  | 'SESSION_MOVE_INVALID'
  | 'SESSION_CWD_MISSING'
  | 'RUN_DIRECTORY_FILE_CONFLICT'
  | 'GROUP_INSTRUCTIONS_CONFLICT'
  | 'AGENT_EXISTS'
  | 'AGENT_NOT_FOUND'
  | 'INVALID_STATUS'
  | 'INVALID_EVENT_TYPE'
  | 'COMMIT_REQUIRED'
  | 'TABLE_STATUS_WITH_MAIN_WORKING';

export class CarnetError extends Error {
  constructor(
    readonly code: CarnetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CarnetError';
  }
}
