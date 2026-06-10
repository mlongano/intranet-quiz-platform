// Barrel for the API layer. Implementation lives in src/api/ split by domain:
//   client.ts          apiFetch, ApiError, downloadExport
//   types.ts           all request/response types
//   auth.ts, quiz.ts, snapshots.ts, classes.ts, sessions.ts,
//   scores.ts, archives.ts, studentSnapshots.ts, superAdmin.ts
// Pages import from "../api" — keep this re-export surface stable.

export * from './api/client';
export * from './api/types';
export * from './api/auth';
export * from './api/quiz';
export * from './api/snapshots';
export * from './api/classes';
export * from './api/sessions';
export * from './api/scores';
export * from './api/archives';
export * from './api/studentSnapshots';
export * from './api/superAdmin';
