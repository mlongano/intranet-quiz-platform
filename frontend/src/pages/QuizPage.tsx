// frontend/src/pages/QuizPage.tsx (Secure Server-Authoritative Version)
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { resumeQuiz, saveAnswer, submitQuiz, Question, Answer, getQuizStatus } from "../api";
import QuestionDisplay from "../components/QuestionDisplay";
import ThemeToggle from "../components/ThemeToggle";
import AccessibilityPanel from "../components/AccessibilityPanel";

// Re-usable ErrorDisplay component
function ErrorDisplay({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="my-4 p-3 bg-error/10 border border-error/40 text-error rounded-lg">
      <p>{message}</p>
    </div>
  );
}

// Re-usable Loading component
function LoadingSpinner() {
  return <div className="min-h-screen flex items-center justify-center text-on-surface-variant">Loading...</div>;
}

function QuizPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [currentAnswer, setCurrentAnswer] = useState<Answer>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const preventContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  // --- Check Quiz Status ---
  const { data: quizStatusData, isLoading: isStatusLoading } = useQuery({
    queryKey: ["quizStatus"],
    queryFn: () => getQuizStatus(),
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // --- Data Fetching: Load current question from server ---
  const {
    data: quizData,
    isLoading,
    error: queryError,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["quiz", quizId],
    queryFn: () => {
      if (!quizId) throw new Error("Quiz ID is missing.");
      console.log(`Loading quiz state for quizId: ${quizId}`);
      return resumeQuiz(quizId);
    },
    enabled: !!quizId,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  // Reset current answer when question changes
  useEffect(() => {
    setCurrentAnswer(null);
    setLocalError(null);
  }, [quizData?.current_index]);

  // --- Mutation for saving answer and advancing to next question ---
  const saveAnswerMutation = useMutation({
    mutationFn: saveAnswer,
    onSuccess: (data) => {
      console.log("Answer saved successfully:", data);
      setCurrentAnswer(null); // Clear the current answer

      // Refetch to get the next question
      queryClient.invalidateQueries({ queryKey: ["quiz", quizId] });
      refetch();
    },
    onError: (err: any) => {
      console.error("Save answer error:", err);
      setLocalError(`Failed to save answer: ${err.message}`);
    },
  });

  // --- Mutation for final submission ---
  const submitMutation = useMutation({
    mutationFn: submitQuiz,
    onSuccess: (data) => {
      console.log("Submit successful:", data);
      queryClient.invalidateQueries({ queryKey: ["quiz", quizId] });
      navigate("/finish");
    },
    onError: (err: any) => {
      console.error("Submit error:", err);
      setLocalError(`Submission failed: ${err.message}`);
    },
  });

  // --- Derived State ---
  const currentQuestion: Question | undefined = quizData?.current_question;
  const currentIndex = quizData?.current_index ?? 0;
  const totalQuestions = quizData?.total_questions ?? 0;
  const isComplete = quizData?.is_complete ?? false;

  // Check if current answer is valid
  const isCurrentAnswered = (() => {
    if (currentAnswer === undefined || currentAnswer === null) return false;
    if (currentQuestion?.type === "open")
      return (currentAnswer as string).trim() !== "";
    if (currentQuestion?.type === "multiple")
      return (currentAnswer as number[]).length > 0;
    return true;
  })();

  // --- Event Handlers ---
  const handleAnswerChange = (answer: Answer) => {
    setCurrentAnswer(answer);
  };

  const handleNext = () => {
    setLocalError(null);

    if (!quizData || !quizId) {
      setLocalError("Quiz data is not loaded correctly.");
      return;
    }

    if (!isCurrentAnswered) {
      setLocalError("Please answer the question before proceeding.");
      return;
    }

    // Save the answer to the server
    saveAnswerMutation.mutate({
      quiz_id: quizId,
      answer: currentAnswer,
    });
  };

  const handleSubmit = () => {
    setLocalError(null);

    if (!quizId) {
      setLocalError("Quiz ID is missing.");
      return;
    }

    // Submit the quiz (server will use stored answers)
    submitMutation.mutate({ quiz_id: quizId });
  };

  // --- Render Logic ---
  if (isLoading || isStatusLoading) return <LoadingSpinner />;

  // Check if quiz is disabled
  if (quizStatusData && !quizStatusData.enabled) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="bg-surface-container rounded-lg border border-outline-variant/30 p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">🚫</div>
          <h2 className="text-2xl font-bold text-on-surface mb-4">Quiz Disabled</h2>
          <p className="text-on-surface-variant mb-6">
            The quiz is currently disabled by the administrator. Please check back later or contact your instructor.
          </p>
          <button onClick={() => navigate("/")} className="px-6 py-2 bg-primary text-on-primary rounded-lg hover:bg-primary/90 transition-colors font-medium">
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

  // Handle quiz completion
  if (isComplete) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="bg-surface-container rounded-lg border border-outline-variant/30 p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">✅</div>
          <h2 className="text-2xl font-bold text-on-surface mb-4">Quiz Complete!</h2>
          <p className="text-on-surface-variant mb-6">
            You have answered all questions. Click the button below to submit your quiz.
          </p>
          {quizData?.message && (
            <p className="text-sm text-on-surface-variant mb-4">{quizData.message}</p>
          )}
          <ErrorDisplay message={localError} />
          <button onClick={handleSubmit} disabled={submitMutation.isPending}
            className="px-6 py-2 bg-tertiary text-on-tertiary font-semibold rounded-lg hover:bg-tertiary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {submitMutation.isPending ? "Submitting..." : "Submit Quiz"}
          </button>
        </div>
      </div>
    );
  }

  // Fallback for missing data
  if (!quizData || !currentQuestion)
    return <ErrorDisplay message="Error: Quiz data missing or invalid." />;

  console.log("Quiz data:", quizData);
  console.log("Current question:", currentQuestion);

  return (
    <main onContextMenu={preventContextMenu} className="w-dvw h-dvh">
      <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
        <AccessibilityPanel />
        <ThemeToggle />
      </div>
      <div
        id="quiz-container"
        className="container mx-auto p-4 max-w-3xl quiz-no-select"
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-on-surface">Quiz: {quizData.student}</h2>
          <span className="text-sm text-on-surface-variant">
            Question {currentIndex + 1} / {totalQuestions}
          </span>
        </div>

        {/* Display local errors */}
        <ErrorDisplay message={localError} />

        <div className="bg-surface-container p-6 rounded-lg border border-outline-variant/30 select-none">
          <QuestionDisplay
            question={currentQuestion}
            currentAnswer={currentAnswer}
            onAnswerChange={handleAnswerChange}
            disableCopy={true}
          />
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={handleNext}
            disabled={!isCurrentAnswered || saveAnswerMutation.isPending}
            className="bg-tertiary text-on-tertiary font-semibold rounded-md px-6 py-2 hover:bg-tertiary/90 focus:outline-none focus:ring-2 focus:ring-tertiary/50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saveAnswerMutation.isPending
              ? "Saving..."
              : "Next"}
          </button>
        </div>
      </div>
    </main>
  );
}

export default QuizPage;
