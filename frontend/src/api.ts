// frontend/src/api.ts (New file)

// Define expected shapes of API responses/requests (improves type safety)
interface StartQuizPayload {
  name: string;
}

interface StartQuizResponse {
  quiz_id: string;
  student: string;
  questions: Question[]; // Define Question type below
}

interface SubmitPayload {
  quiz_id: string;
  student_id: string; // Match backend expectation
  answers: any[]; // Define Answer type more specifically if possible
}

interface SubmitResponse {
  raw_points: number;
  max_points: number;
  percent: number;
}

type ResumeResponse = StartQuizResponse; // Resume returns same shape as start

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
}

export interface ScoreEntry {
  student: string;
  quiz_id: string;
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
}

// --- NEW: Response shapes for scores bank management ---
export interface ScoresBankFilesResponse {
  files: string[]; // List of available scores filenames in the bank
}

// --- API Functions ---

const API_BASE = "/api"; // Or configure as needed

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

// Define the shape of the response for updating questions
export interface UpdateQuestionsResponse {
  success: boolean;
  message: string;
}

// --- New Admin Functions ---

/**
 * Fetches the full list of questions from the admin endpoint.
 * Requires admin password.
 */
export async function fetchAdminQuestions(
  password: string,
): Promise<Question[]> {
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
  return handleResponse<Question[]>(response);
}

/**
 * Updates the questions file on the server.
 * Requires admin password and the full list of questions.
 */
export async function updateAdminQuestions(
  questions: Question[],
  password: string,
): Promise<UpdateQuestionsResponse> {
  console.log(`Updating questions... with password ${password}`);
  const response = await fetch(`${API_BASE}/admin/questions`, {
    method: "PUT", // Or 'PUT' if you implemented that on the backend
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Pass": password, // Send password in a custom header
    },
    body: JSON.stringify({
      // The backend expects an object with a 'questions' key and optionally 'password'
      // Adjust if your backend POST implementation expects the password elsewhere
      questions: questions,
      // password: password // Alternatively, send password inside the main body if header isn't used
    }),
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
 * Fetches the content (questions) of a specific file in the question_bank for preview.
 * Requires admin password and the filename to preview.
 */
export async function fetchPreviewBankFile(
  filename: string,
  password: string,
): Promise<Question[]> {
  // Expecting an array of Question objects
  const response = await fetch(`${API_BASE}/admin/bank/preview`, {
    method: "POST", // Based on backend
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ filename: filename, pw: password }), // Send filename and password
  });
  return handleResponse<Question[]>(response);
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
 * Send quiz result email to a single student.
 */
export async function sendResultEmail(
  student_email: string,
  quiz_id: string,
  password: string,
): Promise<{
  success: boolean;
  message: string;
}> {
  const response = await fetch(`${API_BASE}/admin/email/send-result`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ student_email, quiz_id, pw: password }),
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
    body: JSON.stringify({ pw: password }),
  });
  return handleResponse<{
    success: boolean;
    message: string;
    success_count: number;
    failed_count: number;
    errors: string[];
  }>(response);
}
