// frontend/src/pages/StartPage.tsx (with Tailwind)
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { startQuiz, getQuizStatus } from "../api";

// Key needs to be accessible here too, or imported from a constants file
const QUIZ_STORAGE_KEY = "quiz_state";

// Simple reusable ErrorDisplay component (Example)
function ErrorDisplay({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
      <p>{message}</p>
    </div>
  );
}

function StartPage() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Check quiz status
  const { data: quizStatus, isLoading: isStatusLoading } = useQuery({
    queryKey: ["quizStatus"],
    queryFn: () => getQuizStatus(),
    refetchOnWindowFocus: false,
  });

  const startMutation = useMutation({
    mutationFn: startQuiz,
    onSuccess: (data) => {
      console.log("Quiz started:", data);
      // *** FIX: Clear old state when starting a NEW quiz ***
      try {
        localStorage.removeItem(QUIZ_STORAGE_KEY);
        console.log("Cleared previous quiz state from localStorage.");
      } catch (e) {
        console.error("Failed to clear localStorage:", e);
      }
      navigate(`/quiz/${data.quiz_id}`);
    },
    onError: (err: any) => {
      // ... (error handling as before) ...
      if (err.isConflict && err.quizId) {
        // Don't clear localStorage if resuming
        setError(
          `Quiz already started or completed. Attempting to resume quiz ${err.quizId}...`,
        );
        navigate(`/quiz/${err.quizId}`);
      } else {
        setError(`Error starting quiz: ${err.message}`);
      }
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Please enter your Name / ID.");
      return;
    }
    startMutation.mutate({ name: name.trim().toLowerCase() });
  };

  return (
    // Basic container styling
    <div className="container mx-auto p-4 max-w-md">
      <h1 className="text-2xl font-bold mb-6 text-center">
        Test del{" "}
        {(() => {
          const today = new Date();
          return today.toLocaleDateString("it-IT");
        })()}
      </h1>

      {/* Quiz Status Warning */}
      {!isStatusLoading && quizStatus && !quizStatus.enabled && (
        <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 rounded-lg">
          <div className="flex items-start">
            <div className="flex-shrink-0 text-2xl mr-3">🚫</div>
            <div>
              <h3 className="text-red-800 font-semibold mb-1">Quiz Currently Disabled</h3>
              <p className="text-red-700 text-sm">
                The quiz is currently disabled by the administrator. You cannot start the quiz at this time.
              </p>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="text-red-950-700">Name / ID:</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={startMutation.isPending || (quizStatus && !quizStatus.enabled)}
            required
            className="mt-1 p-2 w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="Enter your identifier"
          />
        </label>
        <button
          type="submit"
          disabled={startMutation.isPending || (quizStatus && !quizStatus.enabled)}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {startMutation.isPending ? "Starting..." : "Start quiz"}
        </button>
      </form>
      <ErrorDisplay message={error} />
    </div>
  );
}

export default StartPage;
