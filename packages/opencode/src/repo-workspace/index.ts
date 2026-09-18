import { doctor } from "./doctor"
import {
  candidatePaths,
  findConfigPath,
  fingerprint,
  gitWorktreeRoot,
  loadFromFile,
  loadFromGitmodules,
  loadFromPrimary,
  loadFromReposList,
  materialize,
  RepoWorkspaceError,
} from "./load"
import {
  canWrite,
  formatLocation,
  locate,
  resolveAbsolute,
  resolveRead,
  resolveWrite,
  rootOf,
} from "./resolve"
import { Access, Defaults, File, Kind, RepositoryConfig } from "./schema"
import * as SessionFingerprint from "./session-fingerprint"
import * as Runtime from "./runtime"
import { formatGlobHits, formatMatches, globAcross, searchAcross } from "./search"
import * as Graph from "./graph"
import * as ChangeSet from "./change-set"
import * as Plan from "./plan"
import * as Verify from "./verify"
import * as Scope from "./scope"
import * as Policy from "./policy"
import * as Git from "./git"
import * as RecordMutation from "./record"
import * as DirtyBaseline from "./dirty-baseline"
import * as ShellJail from "./shell-jail"
import * as EvidenceJudge from "./evidence-judge"
import {
  cloneCommands,
  deriveId,
  findReposListPath,
  missingClones,
  parseReposList,
  reposListToFile,
} from "./repos-list"
import { inspectAll, isSuperproject, parseGitmodules, readGitmodules } from "./gitmodules"

export {
  Access,
  Defaults,
  File,
  Kind,
  RepositoryConfig,
  RepoWorkspaceError,
  SessionFingerprint,
  Runtime,
  candidatePaths,
  canWrite,
  cloneCommands,
  deriveId,
  doctor,
  findConfigPath,
  findReposListPath,
  fingerprint,
  formatGlobHits,
  formatLocation,
  formatMatches,
  gitWorktreeRoot,
  globAcross,
  inspectAll,
  isSuperproject,
  loadFromFile,
  loadFromGitmodules,
  loadFromPrimary,
  loadFromReposList,
  locate,
  materialize,
  missingClones,
  parseGitmodules,
  parseReposList,
  readGitmodules,
  reposListToFile,
  resolveAbsolute,
  resolveRead,
  resolveWrite,
  rootOf,
  searchAcross,
  Graph,
  ChangeSet,
  Plan,
  Verify,
  Scope,
  Policy,
  Git,
  RecordMutation,
  DirtyBaseline,
  ShellJail,
  EvidenceJudge,
}

export type {
  DoctorIssue,
  DoctorReport,
  GitSnapshot,
  Info,
  Location,
  RepositoryDescriptor,
} from "./schema"

export type { ResolveReadResult, ResolveWriteResult } from "./resolve"
export type {
  SessionFingerprint as SessionFingerprintRecord,
  ReconcileResult,
} from "./session-fingerprint"
export type { SubmoduleState, GitmodulesEntry } from "./gitmodules"
export type { ReposListFile, ReposListLine } from "./repos-list"
export type { ApprovalFingerprint, GoalBinding } from "./repo-workspace.sql"
export { RepoWorkspaceStateTable } from "./repo-workspace.sql"
export * as GoalBindingStore from "./goal-binding"
