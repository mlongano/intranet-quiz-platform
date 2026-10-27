// All API request/response types live here (one place to diff against the
// backend response shapes in routes/*.py — see AGENTS.md "API contract").

// ── content ──────────────────────────────────────────────────────────────────

export interface OptionObject {
  text: string;
  image?: string;
}

export interface Question {
  id: string;
  type: 'single' | 'multiple' | 'open';
  weight: number;
  text: string;
  question_image?: string;
  options: Array<string | OptionObject>;
}

export type Answer = number | number[] | string | null;

export interface QuizData {
  title?: string;
  questions: Question[];
  warning?: string;
}

// ── scoring ──────────────────────────────────────────────────────────────────

export interface DetailedAnswer {
  question_id: string | number;
  type?: 'single' | 'multiple' | 'open';
  question_text: string;
  question_image?: string;
  student_answer: any;
  option_student_image?: string | string[] | null;
  option_correct_image?: string | string[] | null;
  correct_answer: any;
  weight: number;
  points_awarded: number;
  raw_points: number;
  raw_student_answer: any;
  raw_correct_answer: any;
  llm_feedback?: string | null;
  /** The teacher's motivation; when set, it is what the student reads instead of llm_feedback. */
  teacher_feedback?: string | null;
  llm_verdict?: string | null;
  llm_status?: 'not_applicable' | 'pending' | 'graded' | 'fallback' | 'error' | null;
  llm_error?: string | null;
  llm_updated_at?: string | null;
  llm_provider?: string | null;
  llm_model?: string | null;
  prompt_version?: string | null;
  question_snapshot?: Record<string, any> | null;
  manual_override?: boolean;
  original_points_awarded?: number | null;
  option_order?: number[];
}

export interface ScoreEntry {
  id?: number;
  student_id?: number;
  student?: string;           // email (legacy compat)
  student_email?: string;
  /** The student's name, as the scores endpoints return it. */
  student_name?: string;
  student_display_name?: string;
  session_id?: number;
  quiz_id?: string;
  quiz_title?: string;
  answers: DetailedAnswer[];
  raw_points: number;
  max_points: number;
  percent: number;
  timestamp?: string;
  submitted_at?: string;
  grading_complete?: boolean;
  pending_open_count?: number;
  pending_open_weight?: number;
}

export interface ScoreChangeSet {
  id: string;
  reason: string;
  actor_type: 'teacher' | 'system';
  changed_by: number | null;
  llm_job_id: number | null;
  reverted_change_id: string | null;
  created_at: string;
  changed_answers: number;
  actor_name: string | null;
}

export interface ScoreOverride {
  score_id: number;
  per_question?: Record<string, number>;
  /** question_id → motivation; an empty string goes back to the model's. */
  feedback?: Record<string, string>;
}

// ── snapshots ────────────────────────────────────────────────────────────────

export interface SnapshotMeta {
  id: number;
  title: string;
  slug: string;
  updated_at: string;
  created_at?: string;
  question_count: number;
  single_count?: number;
  multiple_count?: number;
  open_count?: number;
}

export interface SnapshotDetail extends SnapshotMeta {
  content: QuizData;
  images_manifest: ImageMeta[];
}

export interface ImageMeta {
  filename: string;
  size: number;
  mime: string;
  uploaded_at: string;
  url?: string;
}

// ── sessions ─────────────────────────────────────────────────────────────────

export interface SessionMeta {
  id: number;
  title: string;
  status: 'draft' | 'active' | 'closed';
  join_code: string | null;
  opens_at: string | null;
  closes_at: string | null;
  created_at: string;
  classes: { id: number; name: string }[];
  snapshot_id?: number;   // present on GET /sessions/<id> only
  score_count?: number;   // present on GET /sessions list only
  /** GET /sessions/<id> only: what the edit form may change (the server enforces it). */
  edit?: { quiz: boolean; locked_class_ids: number[] };
  /** GET /sessions/<id> only: when the results were published to students. */
  results_published_at?: string | null;
  results_show_correct?: boolean;
}

export interface LiveStudent {
  id: number;
  name: string;
  email: string;
  classes: string[];
  state: 'submitted' | 'in_progress' | 'not_started';
  answered: number | null;          // in_progress: questions answered so far
  last_activity: string | null;     // in_progress: last answer or draft autosave
  writing: boolean;                 // in_progress: a draft of the current open answer exists
  submitted_at: string | null;
  percent: number | null;
  grading_pending: boolean;         // submitted: open answers still being graded
}

export interface LiveSession {
  id: number;
  title: string;
  join_code: string | null;
  opens_at: string | null;
  closes_at: string | null;
  question_count: number;
  counts: { expected: number; submitted: number; in_progress: number; not_started: number };
  students: LiveStudent[];
}

export interface UpdateSessionPayload {
  title?: string;
  snapshot_id?: number;
  class_ids?: number[];
  opens_at?: string | null;
  closes_at?: string | null;
}

export interface CreateSessionPayload {
  snapshot_id: number;
  title?: string;
  class_ids: number[];
  opens_at?: string;
  closes_at?: string;
}

// ── classes & students ───────────────────────────────────────────────────────

export interface ClassMeta {
  id: number;
  name: string;
  academic_year: string;
  student_count: number;
}

export interface ClassroomCourse {
  id: string;
  name: string;
  section: string;
  title: string;
  course_state: string;
}

export interface ClassroomSyncResult {
  courses_synced: number;
  classes_added: number;
  students_synced: number;
  errors: string[];
}

export interface StudentMeta {
  id: number;
  email: string;
  display_name: string;
  status: string;
}

// ── archives ─────────────────────────────────────────────────────────────────

export interface ArchiveMeta {
  id: number;
  title: string;
  archived_at: string;
  source_session_id: number | null;
}

export interface ArchiveDetail extends ArchiveMeta {
  content: ScoreEntry[];
  notes?: string;
}

// ── student list snapshots ───────────────────────────────────────────────────

export interface StudentListSnapshotMeta {
  id: number;
  title: string;
  created_at: string;
}

export interface StudentListSnapshotDetail extends StudentListSnapshotMeta {
  content: { email: string; display_name: string; classes: string[] }[];
}

// ── auth ─────────────────────────────────────────────────────────────────────

export interface TeacherLoginResponse {
  token: string;
  teacher_id: number;
  role: 'teacher' | 'super_admin';
  email: string;
  display_name: string;
  must_change_password?: boolean;
  change_token?: string;
}

export interface StudentJoinResponse {
  token: string;
  student_id: number;
  session_id: number;
  session_title: string;
  quiz_id?: string;
}

// ── student quiz flow ────────────────────────────────────────────────────────

export interface SessionInfoResponse {
  title: string;
  question_count: number;
  opens_at: string | null;
  closes_at: string | null;
}

export interface AnswerDraft {
  text: string;
  saved_at: string;
}

export interface ResumeResponse {
  quiz_id: string;
  current_question?: Question;
  current_index: number;
  total_questions: number;
  is_complete: boolean;
  /** The autosaved open answer of the current question, if any. */
  draft?: AnswerDraft | null;
}

export interface SaveDraftResponse {
  saved_at: string;
}

export interface SaveAnswerResponse {
  success: boolean;
  current_index: number;
  total_questions: number;
  is_complete: boolean;
}

export interface SubmitResponse {
  raw_points: number;
  max_points: number;
  percent: number;
  status: 'provisional' | 'final';
  grading_complete: boolean;
  pending_open_count: number;
  pending_open_weight: number;
}

// ── email ────────────────────────────────────────────────────────────────────

export interface ResultEmailOptions {
  subject?: string;
  include_details: boolean;
  include_feedback: boolean;
}

// ── llm ──────────────────────────────────────────────────────────────────────

export interface LlmInfoResponse {
  model: string | null;
  provider?: string | null;
  /** Label of the endpoint this teacher's grading goes to. */
  endpoint?: string | null;
  /** True only when grading would actually run: an endpoint resolves and the
   *  teacher has a usable key for it. */
  enabled?: boolean;
  use_llm?: boolean;
  /** Whether the teacher has a key for that endpoint, so the UI can say why
   *  grading is off. */
  key_configured?: boolean;
}

export interface LlmJobStatus {
  id: number;
  teacher_id: number;
  session_id: number;
  score_entry_id: number | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  job_type: 'submission' | 'regrade_score' | 'regrade_session';
  total_items: number;
  processed_items: number;
  error: string | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
}

// ── super-admin ──────────────────────────────────────────────────────────────

export interface TeacherMeta {
  id: number;
  email: string;
  display_name: string;
  role: 'teacher' | 'super_admin';
  status: 'active' | 'disabled';
  last_login_at: string | null;
  last_synced_at: string | null;
}

export interface CreateTeacherPayload {
  email: string;
  display_name: string;
  role: 'teacher' | 'super_admin';
}

export interface CreateTeacherResponse extends TeacherMeta {
  temp_password: string;
}

export interface SyncStatus {
  id: number;
  status: 'running' | 'success' | 'error';
  started_at: string;
  finished_at: string | null;
  result: {
    teachers_added?: number;
    students_added?: number;
    classes_added?: number;
    errors?: string[];
  } | null;
}

/** What the API may say about a stored API key: never the key itself, only
 *  whether one is set and a fingerprint identifying which. */
export interface LlmKeyStatus {
  configured: boolean;
  fingerprint: string | null;
  updated_at?: string | null;
}

/** An endpoint grading may talk to. A super-admin manages only this list —
 *  never keys: each teacher authenticates with their own key per endpoint.
 *  Teachers select an endpoint by id, never by URL. */
export interface LlmEndpoint {
  id: number;
  slug: string;
  label: string;
  protocol: 'openai' | 'anthropic' | 'deepseek';
  base_url: string | null;
  /** Models this endpoint may be asked for; the first is its default. */
  models: string[];
  enabled: boolean;
  is_default: boolean;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export type LlmEndpointPayload = Partial<
  Omit<LlmEndpoint, 'id' | 'created_at' | 'updated_at'>
>;

/** A teacher's own LLM configuration. The API key is never returned — only
 *  whether one is stored and a fingerprint identifying which. */
export interface TeacherLlmSettings {
  endpoint_id: number | null;
  endpoint_label: string | null;
  model: string | null;
  /** The endpoint grading actually uses for this teacher: their selection
   *  while it is enabled, otherwise the default. */
  effective_endpoint_id: number | null;
  available_endpoints: Array<{
    id: number;
    label: string;
    protocol: string;
    models: string[];
    is_default: boolean;
    /** The teacher's own key for this endpoint — the only key ever sent there. */
    key: LlmKeyStatus;
  }>;
  encryption_available: boolean;
}

/** What a regrade would touch, so the panel can warn with real numbers. */
export interface RegradePreview {
  pending: number;
  graded: number;
  manual_override: number;
  /** Models that produced the current evaluations, most used first. */
  models_in_use: string[];
}

export interface RegradeOptions {
  /** 'pending_only' retries what was never graded; 'all' re-grades everything. */
  scope?: 'pending_only' | 'all';
  /** Overwrites the teacher's own corrections. Requires explicit confirmation. */
  force_override_manual?: boolean;
  /** One-off model for this job, without changing the teacher's settings. */
  model?: string | null;
}
