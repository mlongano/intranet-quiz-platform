// frontend/src/api.ts (New file)

// Define expected shapes of API responses/requests (improves type safety)
interface StartQuizPayload {
  name: string;
}

interface StartQuizResponse {
  quiz_id: string;
}

interface SaveAnswerPayload {
  quiz_id: string;
  answer: Answer;
}

interface SaveAnswerResponse {
  success: boolean;
  current_index: number;
  total_questions: number;
  is_complete: boolean;
}

interface SubmitPayload {
  quiz_id: string;
}

interface SubmitResponse {
  raw_points: number;
  max_points: number;
  percent: number;
}

interface ResumeResponse {
  quiz_id: string;
  student: string;
  current_question?: Question;
  current_index: number;
  total_questions: number;
  is_complete: boolean;
  message?: string;
}

export interface Option {
  // Assuming options are just strings based on main.js
  // Adjust if options have IDs or other properties
  text: string;
}

// --- NEW: Type for complex options ---
export interface OptionObject {
  text: string;
  image?: string; // Optional image path (URL)
}

// --- UPDATED: Question Type ---
export interface Question {
  id: string;
  type: "single" | "multiple" | "open";
  weight: number;
  text: string;
  question_image?: string; // Optional question image path (URL)
  options: Array<string | OptionObject>; // Options can be strings or objects
}

// Define Answer type based on how you store them (number, number[], string)
export type Answer = number | number[] | string | null;

// NEW: Quiz data structure with optional title
export interface QuizData {
  title?: string;
  questions: Question[];
  warning?: string; // Optional warning when file has invalid format but is loaded in lenient mode
}

// Define Score type based on scores.jsonc structure + detailed answers
export interface DetailedAnswer {
  question_id: string | number;
  question_text: string;
  question_image?: string; // <-- Add question image here too
  student_answer: any; // Could be string, number[], string[]
  option_student_image?: string | string[] | null; // Optional student image path (URL)
  option_correct_image?: string | string[] | null; // Optional student image path (URL)
  correct_answer: any; // Could be string, string[], object
  weight: number;
  points_awarded: number;
  raw_points: number;
  raw_student_answer: any;
  raw_correct_answer: any;
  // Optional LLM evaluation fields (teacher-only)
  llm_feedback?: string | null;
  llm_verdict?: string | null;
}

export interface ScoreEntry {
  student: string;
  quiz_id: string;
  quiz_title?: string; // Add optional quiz_title field
  answers: DetailedAnswer[]; // Use the detailed structure
  raw_points: number;
  max_points: number;
  percent: number;
  timestamp: string;
}

export interface QuestionBankFilesResponse {
  files: string[]; // List of available quiz filenames in the bank
}

export interface BankOperationResponse {
  success: boolean;
  message: string; // Message from the backend (e.g., filename on save)
  warning?: string; // Optional warning message (e.g., for invalid format)
}

// --- NEW: Response shapes for scores bank management ---
export interface ScoresBankFilesResponse {
  files: string[]; // List of available scores filenames in the bank
}

// --- API Functions ---

const API_BASE = "/api"; // Or configure as needed

/**
 * Get basic quiz information (title and question count) - Public endpoint
 */
export async function getQuizInfo(): Promise<{ title: string; question_count: number }> {
  const response = await fetch(`${API_BASE}/quiz-info`, {
    method: "GET",
  });
  return handleResponse<{ title: string; question_count: number }>(response);
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorMsg = `Request failed: ${response.status} ${response.statusText}`;
    try {
      const serverError = await response.json();
      errorMsg =
        serverError.error ||
        serverError.description ||
        JSON.stringify(serverError);
    } catch {
      try {
        const textError = await response.text();
        if (textError) errorMsg = textError;
      } catch {
        /* ignore */
      }
    }
    const error = new Error(errorMsg) as any;
    if (response.status === 409) {
      try {
        const data = JSON.parse(await response.text()); // Re-parse if needed
        error.quizId = data.quiz_id;
        error.isConflict = true;
      } catch {
        /* ignore if parsing fails again */
      }
    }
    throw error;
  }
  try {
    return (await response.json()) as T;
  } catch (e) {
    throw new Error(
      `Failed to parse server response: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export async function startQuiz(
  payload: StartQuizPayload,
): Promise<StartQuizResponse> {
  const response = await fetch(`${API_BASE}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  // Special handling for 409 Conflict needed here, as it's not strictly an error
  // in the sense of failing the operation, but indicates existing state.
  if (response.status === 409) {
    const data = await response.json();
    // Re-throw with specific info for the component to handle
    const err = new Error(
      data.error || "Quiz already started/completed.",
    ) as any;
    err.quizId = data.quiz_id; // Attach quizId if available for resume
    err.isConflict = true;
    throw err;
  }
  return handleResponse<StartQuizResponse>(response);
}

export async function resumeQuiz(quizId: string): Promise<ResumeResponse> {
  const response = await fetch(`${API_BASE}/resume/${quizId}`);
  return handleResponse<ResumeResponse>(response);
}

export async function saveAnswer(
  payload: SaveAnswerPayload,
): Promise<SaveAnswerResponse> {
  const response = await fetch(`${API_BASE}/save-answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse<SaveAnswerResponse>(response);
}

export async function submitQuiz(
  payload: SubmitPayload,
): Promise<SubmitResponse> {
  const response = await fetch(`${API_BASE}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse<SubmitResponse>(response);
}

export async function fetchScores(password: string): Promise<ScoreEntry[]> {
  const response = await fetch(`${API_BASE}/scores`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pw: password }), // Send password as expected by backend
  });
  // Assuming handleResponse throws on non-ok status
  return handleResponse<ScoreEntry[]>(response);
}

// Function to fetch details for review - REQUIRES NEW BACKEND ENDPOINT
// Example: GET /api/review/student_email@example.com
// Requires password, maybe via header
export async function fetchSubmissionDetails(
  studentId: string,
  password: string,
): Promise<ScoreEntry> {
  // Assuming it returns one detailed entry
  // Adjust URL and method based on your backend implementation
  const safeStudentId = encodeURIComponent(studentId); // URL encode student ID
  const response = await fetch(`${API_BASE}/review/${safeStudentId}`, {
    method: "GET", // Or POST if preferred
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Pass": password, // Example: Send password in a header
    },
  });
  return handleResponse<ScoreEntry>(response);
}

// Function to save overrides - REQUIRES NEW BACKEND ENDPOINT
// Example: POST /api/review
export interface OverridePayload {
  student_id: string;
  quiz_id: string; // To identify the specific submission
  overrides: { question_id: string | number; points: number }[]; // List of questions to override points for
  password: string;
}
export async function saveScoreOverrides(
  payload: OverridePayload,
): Promise<{ success: boolean }> {
  // Example response
  const response = await fetch(`${API_BASE}/review`, {
    // Or appropriate endpoint
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Send necessary data, including password for verification
    body: JSON.stringify(payload),
  });
  return handleResponse<{ success: boolean }>(response);
}

export interface BankOverridePayload {
  filename: string;
  student_id: string;
  quiz_id: string;
  overrides: { question_id: string | number; points: number }[];
  password: string;
}

export interface BankOverrideResponse {
  success: boolean;
  message: string;
  updated_submission: ScoreEntry;
}

export interface LlmInfoResponse {
  provider: string;
  model: string;
  enabled: boolean;
}

export interface RegradeOpenBankResponse {
  success: boolean;
  message: string;
  updated_submissions: number;
  updated_answers: number;
  errors?: string[];
}

export async function saveBankScoreOverrides(
  payload: BankOverridePayload,
): Promise<BankOverrideResponse> {
  const response = await fetch(`${API_BASE}/admin/scores-bank/override`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse<BankOverrideResponse>(response);
}

export async function regradeOpenScoresBank(
  filename: string,
  password: string,
  useLLM?: boolean,
): Promise<RegradeOpenBankResponse> {
  const response = await fetch(`${API_BASE}/admin/scores-bank/regrade-open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, pw: password, use_llm: useLLM }),
  });
  return handleResponse<RegradeOpenBankResponse>(response);
}

export async function fetchLlmInfo(password: string): Promise<LlmInfoResponse> {
  const response = await fetch(`${API_BASE}/admin/llm-info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pw: password }),
  });
  return handleResponse<LlmInfoResponse>(response);
}

// Define the shape of the response for updating questions
export interface UpdateQuestionsResponse {
  success: boolean;
  message: string;
}

// --- New Admin Functions ---

/**
 * Fetches the full quiz data (title and questions) from the admin endpoint.
 * Requires admin password.
 */
export async function fetchAdminQuestions(
  password: string,
): Promise<QuizData> {
  // Send password via header (more secure than query param)
  const response = await fetch(`${API_BASE}/admin/questions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pw: password }), // Send password as expected by backend
    // Or use query param if backend expects that for GET:
    // const response = await fetch(`${API_BASE}/admin/questions?pw=${encodeURIComponent(password)}`);
  });
  // handleResponse will throw for non-ok status (like 401 Unauthorized)
  return handleResponse<QuizData>(response);
}

/**
 * Updates the questions file on the server.
 * Requires admin password and the quiz data (title and questions).
 */
export async function updateAdminQuestions(
  quizData: QuizData,
  password: string,
): Promise<UpdateQuestionsResponse> {
  console.log(`Updating questions... with password ${password}`);
  const response = await fetch(`${API_BASE}/admin/questions`, {
    method: "PUT", // Or 'PUT' if you implemented that on the backend
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Pass": password, // Send password in a custom header
    },
    body: JSON.stringify(quizData), // Send the full quiz data object
  });
  // handleResponse will throw for non-ok status (like 400 Bad Request, 401 Unauthorized, 500 Internal Server Error)
  return handleResponse<UpdateQuestionsResponse>(response);
}

/**
 * Fetches the list of available quiz files in the question_bank folder.
 * Requires admin password.
 */
export async function fetchQuestionBankFiles(
  password: string,
): Promise<QuestionBankFilesResponse> {
  const response = await fetch(`${API_BASE}/admin/bank/files`, {
    method: "POST", // Based on backend implementation
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pw: password }), // Send password
  });
  return handleResponse<QuestionBankFilesResponse>(response);
}

/**
 * Loads a specified quiz file from the question_bank into the active QUEST_FILE.
 * Requires admin password and the filename to load.
 */
export async function loadQuizFromBank(
  filename: string,
  password: string,
): Promise<BankOperationResponse> {
  const response = await fetch(`${API_BASE}/admin/bank/load`, {
    method: "POST", // Based on backend implementation
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename: filename, pw: password }), // Send filename and password
  });
  return handleResponse<BankOperationResponse>(response);
}

/**
 * Saves the current active QUEST_FILE to the question_bank with a date prefix and specified suffix.
 * Requires admin password and the filename suffix.
 */
export async function saveQuizToBank(
  filename_suffix: string,
  password: string,
): Promise<BankOperationResponse> {
  const response = await fetch(`${API_BASE}/admin/bank/save`, {
    method: "POST", // Based on backend implementation
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename_suffix: filename_suffix, pw: password }), // Send suffix and password
  });
  return handleResponse<BankOperationResponse>(response);
}

/**
 * Deletes a quiz file from the question_bank.
 * Requires admin password and the filename to delete.
 */
export async function deleteQuizFromBank(
  filename: string,
  password: string,
): Promise<BankOperationResponse> {
  const response = await fetch(`${API_BASE}/admin/bank/delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename: filename, pw: password }),
  });
  return handleResponse<BankOperationResponse>(response);
}

/**
 * Fetches the content (questions) of a specific file in the question_bank for preview.
 * Requires admin password and the filename to preview.
 */
export async function fetchPreviewBankFile(
  filename: string,
  password: string,
): Promise<Question[]> {
  const response = await fetch(`${API_BASE}/admin/bank/preview`, {
    method: "POST", // Based on backend
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename: filename, pw: password }), // Send filename and password
  });
  const quizData = await handleResponse<QuizData>(response);
  // Backend returns QuizData with {title, questions}, but we only need the questions array
  return quizData.questions;
}

/**
 * Fetches the full quiz data from a bank file for editing (lenient mode).
 */
export async function fetchBankQuizData(
  filename: string,
  password: string,
): Promise<QuizData> {
  const response = await fetch(`${API_BASE}/admin/bank/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename, pw: password, lenient: true }),
  });
  return handleResponse<QuizData>(response);
}

/**
 * Updates a bank quiz file in-place.
 */
export async function updateBankQuiz(
  filename: string,
  quizData: QuizData,
  password: string,
): Promise<UpdateQuestionsResponse> {
  const response = await fetch(`${API_BASE}/admin/bank/update`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Pass": password,
    },
    body: JSON.stringify({ filename, ...quizData }),
  });
  return handleResponse<UpdateQuestionsResponse>(response);
}

// --- NEW Admin Functions for Scores Bank Management ---

/**
 * Fetches the list of available scores files in the scores_bank folder.
 * Requires admin password.
 */
export async function fetchScoresBankFiles(
  password: string,
): Promise<ScoresBankFilesResponse> {
  const response = await fetch(`${API_BASE}/admin/scores-bank/files`, {
    method: "POST", // Based on backend
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pw: password }), // Send password
  });
  return handleResponse<ScoresBankFilesResponse>(response);
}

/**
 * Loads a specified scores file from the scores_bank into the active SCORE_FILE.
 * Requires admin password and the filename to load.
 */
export async function loadScoresFromBank(
  filename: string,
  password: string,
): Promise<BankOperationResponse> {
  const response = await fetch(`${API_BASE}/admin/scores-bank/load`, {
    method: "POST", // Based on backend
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename: filename, pw: password }), // Send filename and password
  });
  return handleResponse<BankOperationResponse>(response);
}

/**
 * Saves the current active SCORE_FILE to the scores_bank with a date prefix and specified suffix.
 * Requires admin password and the filename suffix.
 */
export async function saveScoresToBank(
  filename_suffix: string,
  password: string,
): Promise<BankOperationResponse> {
  const response = await fetch(`${API_BASE}/admin/scores-bank/save`, {
    method: "POST", // Based on backend
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename_suffix: filename_suffix, pw: password }), // Send suffix and password
  });
  return handleResponse<BankOperationResponse>(response);
}

/**
 * Deletes a specified scores file from the scores_bank.
 */
export async function deleteScoresFromBank(
  filename: string,
  password: string,
): Promise<BankOperationResponse> {
  const response = await fetch(`${API_BASE}/admin/scores-bank/delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename: filename, pw: password }),
  });
  return handleResponse<BankOperationResponse>(response);
}

/**
 * Fetches the content (scores) of a specific file in the scores_bank for preview.
 * Requires admin password and the filename to preview.
 */
export async function fetchPreviewScoresBankFile(
  filename: string,
  password: string,
): Promise<ScoreEntry[]> {
  // Expecting an array of ScoreEntry objects
  const response = await fetch(`${API_BASE}/admin/scores-bank/preview`, {
    method: "POST", // Based on backend
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename: filename, pw: password }), // Send filename and password
  });
  return handleResponse<ScoreEntry[]>(response);
}

/**
 * Recalculates all scores against the current question bank.
 * This is useful when question correct answers have been updated.
 */
export async function recalculateAllScores(
  password: string,
): Promise<{
  success: boolean;
  message: string;
  updated_count: number;
  total_count: number;
  errors: string[];
}> {
  const response = await fetch(`${API_BASE}/admin/scores/recalculate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pw: password }),
  });
  return handleResponse<{
    success: boolean;
    message: string;
    updated_count: number;
    total_count: number;
    errors: string[];
  }>(response);
}

/**
 * Clear all scores with a temporary backup.
 */
export async function clearScores(
  password: string,
): Promise<{
  success: boolean;
  message: string;
  backup_file?: string;
  cleared_count?: number;
}> {
  const response = await fetch(`${API_BASE}/admin/scores/clear`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pw: password }),
  });
  return handleResponse<{
    success: boolean;
    message: string;
    backup_file?: string;
    cleared_count?: number;
  }>(response);
}

/**
 * Restore scores from temporary backup.
 */
export async function restoreScores(
  password: string,
): Promise<{
  success: boolean;
  message: string;
  restored_count?: number;
}> {
  const response = await fetch(`${API_BASE}/admin/scores/restore`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pw: password }),
  });
  return handleResponse<{
    success: boolean;
    message: string;
    restored_count?: number;
  }>(response);
}

/**
 * Send quiz result email to a single student.
 */
export async function sendResultEmail(
  student_email: string,
  quiz_id: string,
  password: string,
  subject?: string,
  includeDetails?: boolean,
): Promise<{
  success: boolean;
  message: string;
}> {
  const response = await fetch(`${API_BASE}/admin/email/send-result`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ student_email, quiz_id, pw: password, subject, include_details: includeDetails }),
  });
  return handleResponse<{
    success: boolean;
    message: string;
  }>(response);
}

/**
 * Send quiz result emails to all students.
 */
export async function sendAllResultEmails(
  password: string,
  subject?: string,
  includeDetails?: boolean,
): Promise<{
  success: boolean;
  message: string;
  success_count: number;
  failed_count: number;
  errors: string[];
}> {
  const response = await fetch(`${API_BASE}/admin/email/send-all-results`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pw: password, subject, include_details: includeDetails }),
  });
  return handleResponse<{
    success: boolean;
    message: string;
    success_count: number;
    failed_count: number;
    errors: string[];
  }>(response);
}

/**
 * Student entry type - can be:
 * - A simple email string
 * - An object with email and optional group
 * - An object with group and emails array (for defining multiple students in same group)
 */
export type StudentEntry =
  | string
  | { email: string; group?: string }
  | { group: string; emails: string[] };

/**
 * Fetch the current students list.
 */
export async function fetchStudents(password: string): Promise<StudentEntry[]> {
  const response = await fetch(`${API_BASE}/admin/students?pw=${encodeURIComponent(password)}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });
  return handleResponse<StudentEntry[]>(response);
}

/**
 * Update the students list.
 */
export async function updateStudents(
  students: StudentEntry[],
  password: string,
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/admin/students`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ students, pw: password }),
  });
  return handleResponse<{ success: boolean; message: string }>(response);
}

/**
 * List available students bank files.
 */
export async function listStudentsBankFiles(password: string): Promise<{ files: string[] }> {
  const response = await fetch(`${API_BASE}/admin/students-bank/files`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pw: password }),
  });
  return handleResponse<{ files: string[] }>(response);
}

/**
 * Load a students file from the students bank.
 */
export async function loadStudentsFromBank(
  filename: string,
  password: string,
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/admin/students-bank/load`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename, pw: password }),
  });
  return handleResponse<{ success: boolean; message: string }>(response);
}

/**
 * Save current students to the students bank.
 */
export async function saveStudentsToBank(
  filename: string,
  password: string,
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/admin/students-bank/save`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename, pw: password }),
  });
  return handleResponse<{ success: boolean; message: string }>(response);
}



/**
 * Renames a quiz file in the question_bank.
 */
export async function renameQuizInBank(
  filename: string,
  newFilename: string,
  password: string,
): Promise<BankOperationResponse> {
  const response = await fetch(`${API_BASE}/admin/bank/rename`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename, new_filename: newFilename, pw: password }),
  });
  return handleResponse<BankOperationResponse>(response);
}

/**
 * Renames a scores file in the scores_bank.
 */
export async function renameScoresInBank(
  filename: string,
  newFilename: string,
  password: string,
): Promise<BankOperationResponse> {
  const response = await fetch(`${API_BASE}/admin/scores-bank/rename`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename, new_filename: newFilename, pw: password }),
  });
  return handleResponse<BankOperationResponse>(response);
}

/**
 * Renames a students file in the students_bank.
 */
export async function renameStudentsInBank(
  filename: string,
  newFilename: string,
  password: string,
): Promise<BankOperationResponse> {
  const response = await fetch(`${API_BASE}/admin/students-bank/rename`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename, new_filename: newFilename, pw: password }),
  });
  return handleResponse<BankOperationResponse>(response);
}

/**
 * Generates the download URL for a quiz file.
 */
export function getQuizDownloadUrl(filename: string, password: string): string {
  return `${API_BASE}/admin/bank/download/${encodeURIComponent(filename)}?password=${encodeURIComponent(password)}`;
}

/**
 * Generates the download URL for a scores file.
 */
export function getScoresDownloadUrl(filename: string, password: string): string {
  return `${API_BASE}/admin/scores-bank/download/${encodeURIComponent(filename)}?password=${encodeURIComponent(password)}`;
}

/**
 * Generates the download URL for a students file.
 */
export function getStudentsDownloadUrl(filename: string, password: string): string {
  return `${API_BASE}/admin/students-bank/download/${encodeURIComponent(filename)}?password=${encodeURIComponent(password)}`;
}

/**
 * Deletes a specified students file from the students_bank.
 */
export async function deleteStudentsFromBank(
  filename: string,
  password: string,
): Promise<BankOperationResponse> {
  const response = await fetch(`${API_BASE}/admin/students-bank/delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename: filename, pw: password }),
  });
  return handleResponse<BankOperationResponse>(response);
}

/**
 * Preview a students bank file.
 */
export async function previewStudentsBankFile(
  filename: string,
  password: string,
): Promise<{ students: StudentEntry[]; filename: string }> {
  const response = await fetch(`${API_BASE}/admin/students-bank/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename, pw: password }),
  });
  return handleResponse<{ students: StudentEntry[]; filename: string }>(response);
}

/**
 * Git Sync Types and Functions
 */
export interface GitSyncStatus {
  configured: boolean;
  initialized: boolean;
  remote_url: string | null;
  has_changes: boolean;
  last_commit: string | null;
  behind_remote: boolean;
}

export interface GitSyncResult {
  success: boolean;
  message: string;
  details?: {
    pulled: boolean;
    committed: boolean;
    pushed: boolean;
    changes: string[];
  };
}

/**
 * Get Git sync status.
 */
export async function getGitSyncStatus(password: string): Promise<GitSyncStatus> {
  const response = await fetch(`${API_BASE}/admin/git-sync/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  return handleResponse<GitSyncStatus>(response);
}

/**
 * Initialize Git repository in banks directory.
 */
export async function initGitSync(password: string): Promise<GitSyncResult> {
  const response = await fetch(`${API_BASE}/admin/git-sync/init`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  return handleResponse<GitSyncResult>(response);
}

/**
 * Sync banks with remote Git repository.
 */
export async function syncBanks(password: string, pullFirst: boolean = true): Promise<GitSyncResult> {
  const response = await fetch(`${API_BASE}/admin/git-sync/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password, pull_first: pullFirst }),
  });
  return handleResponse<GitSyncResult>(response);
}


/**
 * Quiz Status Types and Functions
 */
export interface QuizStatus {
  enabled: boolean;
}

/**
 * Get the current quiz enabled/disabled status (public endpoint).
 */
export async function getQuizStatus(): Promise<QuizStatus> {
  const response = await fetch(`${API_BASE}/admin/quiz-status`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });
  return handleResponse<QuizStatus>(response);
}

/**
 * Set the quiz enabled/disabled status (requires admin password).
 */
export async function setQuizStatus(enabled: boolean, password: string): Promise<{
  success: boolean;
  message: string;
  status: QuizStatus;
}> {
  const response = await fetch(`${API_BASE}/admin/quiz-status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ enabled, pw: password }),
  });
  return handleResponse<{
    success: boolean;
    message: string;
    status: QuizStatus;
  }>(response);
}


/**
 * Image Management Types and Functions
 */

export interface QuizImage {
  filename: string;
  path: string;
  size: number;
}

export interface UploadImageResponse {
  success: boolean;
  path: string;
  filename: string;
}

/**
 * Upload an image for a specific quiz.
 */
export async function uploadImage(
  quizFilename: string,
  imageFile: File,
  password: string
): Promise<UploadImageResponse> {
  const formData = new FormData();
  formData.append('quiz_filename', quizFilename);
  formData.append('image', imageFile);
  formData.append('password', password);

  const response = await fetch(`${API_BASE}/admin/images/upload`, {
    method: "POST",
    body: formData,
  });
  return handleResponse<UploadImageResponse>(response);
}

/**
 * List all images for a specific quiz.
 */
export async function listQuizImages(
  quizFilename: string,
  password: string
): Promise<QuizImage[]> {
  const response = await fetch(
    `${API_BASE}/admin/images/list/${encodeURIComponent(quizFilename)}?password=${encodeURIComponent(password)}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
  const data = await handleResponse<{ images: QuizImage[] }>(response);
  return data.images;
}

/**
 * Delete an image from a quiz's images folder.
 */
export async function deleteImage(
  quizFilename: string,
  imageFilename: string,
  password: string
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/admin/images/delete`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      quiz_filename: quizFilename,
      image_filename: imageFilename,
      password,
    }),
  });
  return handleResponse<{ success: boolean; message: string }>(response);
}

/**
 * Clear all images from the active quiz images folder.
 */
export async function clearActiveQuizImages(
  password: string
): Promise<{ success: boolean; message: string; deleted_count: number }> {
  const response = await fetch(`${API_BASE}/admin/images/clear-active`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  return handleResponse<{ success: boolean; message: string; deleted_count: number }>(response);
}

