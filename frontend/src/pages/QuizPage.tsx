// frontend/src/pages/QuizPage.tsx (with Tailwind)
import { useState, useMemo, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { resumeQuiz, submitQuiz, Question, Answer, getQuizStatus } from "../api";
import QuestionDisplay from "../components/QuestionDisplay";
// Assume these helper components exist
// import ErrorDisplay from '../components/ErrorDisplay';
// import LoadingSpinner from '../components/LoadingSpinner';

// Re-usable ErrorDisplay component (can be moved to its own file)
function ErrorDisplay({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="my-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
      <p>{message}</p>
    </div>
  );
}

// Re-usable Loading component
function LoadingSpinner() {
  return <div className="text-center p-4">Loading...</div>;
}

// Key for local storage
const QUIZ_STORAGE_KEY = "quiz_state";

// Type for saved state in localStorage
interface SavedQuizState {
  quiz_id: string;
  student_id: string; // Good to store for verification, though maybe not essential here
  answers: Record<number, Answer>;
  current: number;
}

function QuizPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [localError, setLocalError] = useState<string | null>(null);
  const [isStateRestored, setIsStateRestored] = useState(false); // Flag to prevent re-restoring

  const preventContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  console.log("Try to prevent selection and context menu");

  // --- Check Quiz Status ---
  const { data: quizStatusData, isLoading: isStatusLoading } = useQuery({
    queryKey: ["quizStatus"],
    queryFn: () => getQuizStatus(),
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // --- Data Fetching ---
  const {
    data: quizData,
    isLoading,
    error: queryError,
    isError,
    isSuccess,
  } = useQuery({
    queryKey: ["quiz", quizId],
    queryFn: () => {
      if (!quizId) throw new Error("Quiz ID is missing.");
      console.log(`useQuery fetching for quizId: ${quizId}`);
      return resumeQuiz(quizId);
    },
    enabled: !!quizId,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  // --- Restore State Effect ---
  useEffect(() => {
    // Only run once after quizData is successfully loaded and state hasn't been restored yet
    if (isSuccess && quizData && quizId && !isStateRestored) {
      console.log(
        "Attempting to restore state from localStorage for quiz:",
        quizId,
      );
      try {
        const savedStateString = localStorage.getItem(QUIZ_STORAGE_KEY);
        if (savedStateString) {
          const savedState = JSON.parse(savedStateString) as SavedQuizState;
          console.log("Found saved state:", savedState);

          // *** Crucial Check: Only restore if quiz IDs match ***
          if (savedState.quiz_id === quizId) {
            console.log("Matching quizId found, restoring state.");
            // Validate restored index
            const totalQuestions = quizData.questions?.length ?? 0;
            let restoredIndex = savedState.current ?? 0;
            if (restoredIndex >= totalQuestions) {
              console.warn(
                `Restored index ${restoredIndex} out of bounds, resetting to 0.`,
              );
              restoredIndex = 0;
            }

            // Restore state variables
            setAnswers(savedState.answers ?? {});
            setCurrentQuestionIndex(restoredIndex);
          } else {
            console.log("Saved state is for a different quiz_id, ignoring.");
            // Optional: Clear localStorage if it's for a different quiz?
            // localStorage.removeItem(QUIZ_STORAGE_KEY);
          }
        } else {
          console.log("No saved state found in localStorage.");
        }
      } catch (e) {
        console.error("Error reading or parsing localStorage state:", e);
        // Clear potentially corrupt state
        localStorage.removeItem(QUIZ_STORAGE_KEY);
      } finally {
        // Mark state as restored (or attempted) to prevent re-running
        setIsStateRestored(true);
      }
    }
  }, [isSuccess, quizData, quizId, isStateRestored]); // Dependencies for effect

  // --- Persist State Effect ---
  const persistState = useCallback(() => {
    // Only persist if data has loaded, we have a student, and state has been initially restored
    if (quizData?.student && quizId && isStateRestored) {
      console.log(
        `Persisting state: index=${currentQuestionIndex}, answers#=${Object.keys(answers).length}`,
      );
      const stateToSave: SavedQuizState = {
        quiz_id: quizId,
        student_id: quizData.student, // Store student from fetched data
        answers: answers,
        current: currentQuestionIndex,
      };
      try {
        localStorage.setItem(QUIZ_STORAGE_KEY, JSON.stringify(stateToSave));
      } catch (e) {
        console.error("Error saving state to localStorage:", e);
        // Handle potential storage quota errors?
      }
    }
  }, [quizId, quizData, answers, currentQuestionIndex, isStateRestored]); // Dependencies for persist function

  // Call persist whenever answers or current index change *after* initial restoration
  useEffect(() => {
    if (isStateRestored) {
      // Only persist after initial restore attempt
      persistState();
    }
  }, [answers, currentQuestionIndex, isStateRestored, persistState]);

  const currentQuestion: Question | undefined = useMemo(() => {
    return quizData?.questions?.[currentQuestionIndex];
  }, [quizData, currentQuestionIndex]);

  const isCurrentAnswered = useMemo(() => {
    // ... (same logic as before) ...
    const answer = answers[currentQuestionIndex];
    if (answer === undefined || answer === null) return false;
    if (currentQuestion?.type === "open")
      return (answer as string).trim() !== "";
    if (currentQuestion?.type === "multiple")
      return (answer as number[]).length > 0;
    return true;
  }, [answers, currentQuestionIndex, currentQuestion]);

  const submitMutation = useMutation({
    // ... (same mutation logic as before) ...
    mutationFn: submitQuiz,
    onSuccess: (data) => {
      console.log("Submit successful:", data);

      // Clear the persisted state from localStorage
      try {
        localStorage.removeItem(QUIZ_STORAGE_KEY);
        console.log("Cleared quiz state from localStorage after submission.");
      } catch (e) {
        console.error("Failed to clear localStorage after submission:", e);
      }

      // Optionally invalidate React Query cache if needed
      queryClient.invalidateQueries({ queryKey: ["quiz", quizId] });
      navigate("/finish");
    },
    onError: (err: any) => {
      setLocalError(`Submission failed: ${err.message}`);
    },
  });

  // --- Derived State ---
  const totalQuestions = quizData?.questions?.length ?? 0;
  const isLastQuestion = currentQuestionIndex === totalQuestions - 1;

  // --- Event Handlers ---
  const handleAnswerChange = (answer: Answer) => {
    setAnswers((prev) => ({ ...prev, [currentQuestionIndex]: answer }));
  };

  const handleNext = () => {
    setLocalError(null);
    if (!quizData || !quizId || !quizData.student || totalQuestions === 0) {
      setLocalError("Quiz data is not loaded correctly.");
      return;
    }

    if (isLastQuestion) {
      const orderedAnswers = Array.from(
        { length: totalQuestions },
        (_, index) => answers[index] ?? null,
      );
      submitMutation.mutate({
        quiz_id: quizId,
        student_id: quizData.student,
        answers: orderedAnswers,
      });
    } else {
      setCurrentQuestionIndex((prev) => prev + 1);
    }
  };

  // --- Render Logic ---
  if (isLoading || isStatusLoading) return <LoadingSpinner />;

  // Check if quiz is disabled
  if (quizStatusData && !quizStatusData.enabled) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">🚫</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Quiz Disabled</h2>
          <p className="text-gray-600 mb-6">
            The quiz is currently disabled by the administrator. Please check back later or contact your instructor.
          </p>
          <button
            onClick={() => navigate("/")}
            className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  // Use queryError directly if available
  if (isError)
    return (
      <ErrorDisplay message={`Failed to load quiz: ${queryError?.message}`} />
    );
  // Fallback for other errors or missing data
  if (!quizData || !currentQuestion)
    return <ErrorDisplay message="Error: Quiz data missing or invalid." />;

  console.log("Quiz data:", quizData);
  console.log("Current question:", currentQuestion);
  return (
    <main onContextMenu={preventContextMenu} className="w-dvw h-dvh">
      <div
        id="quiz-container"
        className="container mx-auto p-4 max-w-3xl quiz-no-select"
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Quiz: {quizData.student}</h2>
          <span className="text-sm text-gray-600">
            Question {currentQuestionIndex + 1} / {totalQuestions}
          </span>
        </div>

        {/* Display local errors (e.g., from submit) */}
        <ErrorDisplay message={localError} />

        <div className="bg-white p-6 rounded shadow-md border border-gray-200 select-none">
          <QuestionDisplay
            question={currentQuestion}
            currentAnswer={answers[currentQuestionIndex]}
            onAnswerChange={handleAnswerChange}
            disableCopy={true}
          />
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={handleNext}
            disabled={!isCurrentAnswered || submitMutation.isPending}
            className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitMutation.isPending
              ? "Submitting..."
              : isLastQuestion
                ? "Finish & Submit"
                : "Next"}
          </button>
        </div>
      </div>
    </main>
  );
}

export default QuizPage;
