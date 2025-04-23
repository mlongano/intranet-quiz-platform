// static/main.js (Revised based on user's version and previous logic)

/* ---------- DOM shortcuts ---------- */
const $ = (s) => document.querySelector(s);

const intro = $("#intro");
const quizSec = $("#quiz");
const finish = $("#finish");
const errorsP = $("#errors>p"); // Target the <p> tag inside #errors
const errorsContainer = $("#errors");

let studentName = null; // Variable to store student name/ID
let quiz = null; // {quiz_id, student, questions[]}
let answers = [];
let current = 0;

/* ---------- Helper Function for Errors ---------- */
function showError(message) {
  console.error("Error:", message); // Keep logging for debugging
  errorsP.textContent = message;
  errorsContainer.hidden = false;
  // Hide other sections potentially?
  quizSec.hidden = true;
  finish.hidden = true;
  intro.hidden = true; // Or maybe keep intro visible? Adjust as needed.
}

function hideError() {
  errorsContainer.hidden = true;
  errorsP.textContent = ""; // Clear previous message
}

/* ---------- POST Helper (Handles basic errors) ---------- */
const POST = async (url, data) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    let errorMsg = `Request failed with status: ${response.status}`;
    try {
      // Try to get more specific error from server response text
      const serverError = await response.text();
      if (serverError) {
        // Attempt to parse as JSON *only if* content type suggests it
        // This handles cases where Flask might return JSON errors even on 4xx/5xx
        if (
          response.headers.get("Content-Type")?.includes("application/json")
        ) {
          try {
            const errorJson = JSON.parse(serverError);
            errorMsg = errorJson.error || errorJson.description || serverError;
          } catch (parseError) {
            errorMsg = serverError; // Use raw text if JSON parse fails
          }
        } else {
          errorMsg = serverError; // Use raw text for non-JSON errors
        }
      }
    } catch (e) {
      /* Ignore errors reading the error response body */
    }
    throw new Error(errorMsg); // Throw error to be caught by calling function
  }
  // Only parse JSON if response is OK
  try {
    return await response.json();
  } catch (e) {
    throw new Error("Failed to parse successful server response as JSON.");
  }
};

/* ---------- start quiz ---------- */
$("#start-btn").onclick = async () => {
  hideError(); // Clear previous errors
  const nameInput = $("#student-name").value.trim();
  if (!nameInput) {
    // Use alert for this specific validation, or the error section
    showError("Please enter your Name / ID.");
    intro.hidden = false; // Ensure intro is visible for correction
    return;
  }
  studentName = nameInput.toLowerCase(); // Store and normalize

  let resp;
  try {
    // Send name to /api/start
    resp = await fetch("/api/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: studentName }),
    });

    const data = await resp.json(); // Try parsing JSON regardless of status first

    if (!resp.ok) {
      // Handle specific error statuses returned by the modified backend
      if (resp.status === 409) {
        // Conflict
        if (data.quiz_id) {
          // Unfinished attempt exists, try resuming
          resumeQuiz(data.quiz_id); // Resume needs the ID
        } else {
          // Already completed or other conflict
          showError(data.error || "Quiz start conflict.");
          intro.hidden = false;
        }
      } else if (resp.status === 403) {
        // Forbidden
        showError(data.error || "Unknown student.");
        intro.hidden = false;
      } else {
        // Other errors (400, 500, etc.)
        showError(`Failed to start quiz: ${data.error || resp.statusText}`);
        intro.hidden = false;
      }
      studentName = null; // Clear name on failure
      return; // Stop processing
    }

    // --- Start new quiz successfully ---
    quiz = data;
    // Verify or set student name from response
    if (quiz.student && quiz.student !== studentName) {
      console.warn(
        "Student name mismatch during start:",
        studentName,
        quiz.student,
      );
      studentName = quiz.student; // Trust server
    } else if (!quiz.student) {
      quiz.student = studentName; // Add if missing
    }

    answers = [];
    current = 0;
    persist(); // Persist the initial state including studentName

    intro.hidden = true;
    quizSec.hidden = false;
    finish.hidden = true;
    renderQuestion();
  } catch (e) {
    // Catch network errors or JSON parsing errors
    showError(`Cannot reach server or process response: ${e.message}`);
    intro.hidden = false;
    studentName = null; // Clear name on failure
  }
};

/* ---------- navigation ---------- */
$("#next-btn").onclick = () => {
  // This part should be okay, assuming renderQuestion updates the UI correctly
  hideError(); // Hide error when navigating
  storeAnswer();
  current++;
  persist();

  if (current < quiz.questions.length) {
    renderQuestion();
  } else {
    submitQuiz();
  }
};

/* ---------- render one question ---------- */
function renderQuestion() {
  // Ensure quiz and questions exist
  if (!quiz || !quiz.questions || current >= quiz.questions.length) {
    showError("Error: Quiz data is missing or invalid.");
    quizSec.hidden = true; // Hide quiz section if data is bad
    return;
  }

  const q = quiz.questions[current];

  $("#q-count").textContent = `${current + 1} / ${quiz.questions.length}`;
  $("#q-text").textContent = q.text || "[Question text missing]"; // Handle missing text

  const optDiv = $("#options");
  const openBox = $("#open-answer");
  optDiv.innerHTML = "";
  openBox.value = ""; // Reset textarea
  openBox.style.display = "none";

  if (q.type === "open") {
    openBox.style.display = "block";
    openBox.value = answers[current] || "";
    openBox.oninput = setNextEnabled;
    // Focus the textarea for open questions
    // Use setTimeout to ensure it's visible first
    setTimeout(() => openBox.focus(), 0);
  } else {
    (q.options || []).forEach((text, i) => {
      // Handle missing options array
      const id = `q${current}_o${i}`;
      const inp = document.createElement("input");

      inp.type = q.type === "single" ? "radio" : "checkbox";
      inp.name = "opt"; // Important for radio buttons
      inp.value = i;
      inp.id = id;
      if (isChecked(i)) inp.checked = true;
      inp.onchange = setNextEnabled;

      const lab = document.createElement("label");
      lab.htmlFor = id;
      lab.textContent = " " + (text ?? `[Option ${i + 1} text missing]`); // Handle null/undefined text

      const div = document.createElement("div"); // Wrap each in a div for better structure/styling
      div.append(inp, lab);
      optDiv.append(div);
    });
  }
  setNextEnabled(); // Set initial button state
}

// isChecked remains the same
function isChecked(optionIndex) {
  const a = answers[current];
  if (a == null) return false;
  return Array.isArray(a) ? a.includes(optionIndex) : a === optionIndex;
}

// answered remains the same
function answered() {
  // ... (no changes needed) ...
  const q = quiz.questions[current];
  if (!q) return false; // Guard against missing question

  if (q.type === "open") return $("#open-answer").value.trim() !== "";

  if (q.type === "single")
    return document.querySelector("#options input:checked") !== null;

  if (q.type === "multiple")
    return document.querySelectorAll("#options input:checked").length > 0;

  return false; // Should not happen with valid types
}

// setNextEnabled remains the same
function setNextEnabled() {
  $("#next-btn").disabled = !answered();
}

// storeAnswer remains the same
function storeAnswer() {
  // ... (no changes needed) ...
  const q = quiz.questions[current];
  if (!q) return; // Guard

  if (q.type === "open") {
    answers[current] = $("#open-answer").value.trim();
  } else if (q.type === "single") {
    const checked = document.querySelector("#options input:checked");
    answers[current] = checked ? Number(checked.value) : null;
  } else {
    // multiple
    const checked = [...document.querySelectorAll("#options input:checked")];
    answers[current] = checked.map((el) => Number(el.value));
  }
}

/* ---------- submit ---------- */
async function submitQuiz() {
  hideError(); // Hide previous errors
  const nextBtn = $("#next-btn");
  nextBtn.disabled = true;
  nextBtn.textContent = "Submitting…";

  if (!studentName) {
    showError("Error: Student identifier is missing. Cannot submit.");
    nextBtn.disabled = false; // Re-enable button
    nextBtn.textContent = "Next";
    return;
  }

  try {
    // Use the POST helper which throws on non-ok status
    const result = await POST("/api/submit", {
      quiz_id: quiz.quiz_id,
      student_id: studentName, // Send student identifier
      answers: answers,
    });

    // Successful submission
    localStorage.removeItem(KEY); // Clear state on success
    studentName = null;
    quizSec.hidden = true;
    finish.hidden = false;
    console.log("Grading result:", result);
  } catch (e) {
    // Display the error message from POST helper in the error section
    showError(`Submission failed: ${e.message}`);
    // Re-enable button
    nextBtn.disabled = false;
    nextBtn.textContent = "Next";
    // Do not automatically proceed or clear state on error
  }
}

/* ---------- crash‑safe persistence ---------- */
const KEY = "quiz_state";
function persist() {
  // Only persist if we have valid state
  if (!quiz || !quiz.quiz_id || !studentName) {
    console.warn("Attempted to persist invalid state.");
    return;
  }
  localStorage.setItem(
    KEY,
    JSON.stringify({
      quiz_id: quiz.quiz_id,
      student_id: studentName, // Include student name/ID
      answers,
      current,
    }),
  );
}

/* ---------- Resume Logic ---------- */
function resumeQuiz(resume_quiz_id) {
  hideError();
  console.log(`Attempting to resume quiz: ${resume_quiz_id}`);
  fetch(`/api/resume/${resume_quiz_id}`)
    .then((r) => {
      if (!r.ok) {
        // Try to get a text message, then throw
        return r.text().then((text) => {
          throw new Error(text || `Resume failed with status ${r.status}`);
        });
      }
      return r.json();
    })
    .then((data) => {
      if (!data || !data.student || !data.quiz_id || !data.questions) {
        throw new Error("Invalid resume data received from server.");
      }

      // Restore state from server response
      quiz = data;
      studentName = data.student; // Restore student name from server data

      // Restore answers/current from localStorage, checking consistency
      const savedState = JSON.parse(localStorage.getItem(KEY) || "null");
      if (savedState && savedState.quiz_id === resume_quiz_id) {
        // Optional: Verify student_id if you stored it reliably before
        // if (savedState.student_id && savedState.student_id !== studentName) { ... }
        answers = savedState.answers || [];
        current = savedState.current || 0;
        // Validate 'current' index against number of questions
        if (current >= quiz.questions.length) {
          console.warn("Saved 'current' index out of bounds, resetting to 0.");
          current = 0;
        }
        // Validate 'answers' length?
        if (answers.length > quiz.questions.length) {
          console.warn(
            "Saved 'answers' length exceeds question count, truncating.",
          );
          answers = answers.slice(0, quiz.questions.length);
        } else {
          // Pad answers array if needed (e.g., if user closed browser mid-question)
          while (answers.length < current) {
            answers.push(null); // Or appropriate default
          }
        }

        console.log(
          `Resumed state: student=${studentName}, current=${current}, answers#=${answers.length}`,
        );
      } else {
        console.log(
          "No valid saved state in localStorage or mismatch, starting resume from beginning.",
        );
        answers = [];
        current = 0;
      }

      persist(); // Re-persist the potentially corrected/merged state

      intro.hidden = true;
      quizSec.hidden = false;
      finish.hidden = true;
      renderQuestion();
    })
    .catch((err) => {
      showError(`Could not resume quiz: ${err.message}`);
      localStorage.removeItem(KEY); // Clear invalid state
      studentName = null;
      // Show intro again
      intro.hidden = false;
      quizSec.hidden = true;
      finish.hidden = true;
    });
}

// Self-invoking function to check for resume state on page load
(function () {
  const saved = JSON.parse(localStorage.getItem(KEY) || "null");
  // Check for both quiz_id and student_id before attempting resume
  if (!saved || !saved.quiz_id || !saved.student_id) {
    console.log("No valid saved state found for resume.");
    return;
  }
  // Store the student name from localStorage *before* calling resume
  // This helps if resume itself fails, we might still know who the user was.
  studentName = saved.student_id;
  resumeQuiz(saved.quiz_id);
})();
