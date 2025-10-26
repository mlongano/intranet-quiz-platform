// frontend/src/components/QuestionEditorPage.tsx (React Query Version)

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { parse, ParseError } from "jsonc-parser"; // Import parse from jsonc-parser

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchAdminQuestions, updateAdminQuestions, QuizData, Question } from "../api"; // Import both QuizData and Question
import { useLocation, useNavigate } from "react-router-dom";
import QuestionDisplay from "../components/QuestionDisplay";

const QuestionEditor: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  // Attempt to get password from navigation state (insecure, lost on refresh)
  const adminPassword = location.state?.adminPassword;
  // Local state for the editable JSON string and password
  const [questionsJson, setQuestionsJson] = useState<string>("");
  const [lengthOfQuestions, setLengthOfQuestions] = useState<number>(0);
  const [commonWeight, setCommonWeight] = useState<string>("1");
  const [showPreview, setShowPreview] = useState<boolean>(false);
  // Local state for user feedback messages not directly tied to query status
  const [userMessage, setUserMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const queryClient = useQueryClient();

  // --- Fetch Questions using useQuery ---
  const queryKey = ["adminQuestions", adminPassword]; // Query key depends on password

  const {
    data: questionsData, // The actual data returned by the API
    isLoading: isLoadingQuestions, // Loading state specific to the query
    isError: isLoadError,
    error: loadError,
    refetch: refetchQuestions, // Function to manually trigger a refetch
    isFetching: isFetchingQuestions, // True if fetching, including background refetches
  } = useQuery<QuizData, Error>({
    // Specify types for data and error
    queryKey: queryKey,
    queryFn: () => {
      if (!adminPassword) {
        // Should not happen if 'enabled' is false, but defensively return empty array or throw
        return Promise.reject(new Error("Password not available"));
      }
      return fetchAdminQuestions(adminPassword);
    },
    enabled: !!adminPassword, // Only run the query if password exists
    staleTime: 5 * 60 * 1000, // Keep data fresh for 5 minutes
    // Keep previous data while refetching after password entry or manual refetch
    // placeholderData: (previousData) => previousData, // TanStack Query v5 syntax
    refetchOnWindowFocus: false, // Optional: disable refetch on window focus
  });

  // Effect to update the local JSON state when query data changes
  useEffect(() => {
    if (questionsData) {
      setQuestionsJson(JSON.stringify(questionsData, null, 2));

      // Check if there's a warning about invalid format
      if (questionsData.warning) {
        setUserMessage({
          type: "error",
          text: questionsData.warning,
        });
        // Don't auto-clear warning messages - they're important
      } else {
        setUserMessage({
          type: "success",
          text: "Questions loaded successfully",
        });
        setTimeout(() => setUserMessage(null), 2000);
      }

      setLengthOfQuestions(questionsData.questions?.length || 0);
    } else if (!isLoadingQuestions && adminPassword) {
      // Handle case where data is null/undefined after loading finishes (e.g., if API returns empty successfully)
      setQuestionsJson(JSON.stringify({ title: "", questions: [] }, null, 2)); // Set to empty quiz data
    }
  }, [questionsData, isLoadingQuestions, adminPassword]);

  // Extract quiz title from the current data
  const quizTitle = useMemo(() => {
    try {
      const parsed = JSON.parse(questionsJson || '{}');
      return parsed?.title || '';
    } catch {
      return '';
    }
  }, [questionsJson]);

  // --- Update Questions using useMutation ---
  const {
    mutate: saveQuestionsMutation,
    isPending: isSaving, // Renamed from isLoading for mutations in v5
    isError: isSaveError,
    error: saveError,
    // Removed unused isSuccess: isSaveSuccess
  } = useMutation<
    { success: boolean; message: string }, // Type of response on success
    Error, // Type of error
    QuizData // Type of variables passed to the mutation function
  >({
    mutationFn: (updatedQuizData: QuizData) => {
      if (!adminPassword) {
        return Promise.reject(new Error("Password not available for saving"));
      }
      return updateAdminQuestions(updatedQuizData, adminPassword);
    },
    onSuccess: (data) => {
      // Invalidate the questions query cache to trigger a refetch
      queryClient.invalidateQueries({ queryKey: queryKey });
      // Set success message from API response or a default one
      setUserMessage({
        type: "success",
        text: data.message || "Questions saved successfully!",
      });
      setTimeout(() => setUserMessage(null), 2000);
      // Optionally clear local JSON or rely on refetch to update it
    },
    onError: (err) => {
      // Error message is handled via isSaveError/saveError state
      setUserMessage({ type: "error", text: `Save failed: ${err.message}` });
    },
  });

  // --- Event Handlers ---
  const handleSaveChanges = useCallback(() => {
    if (!questionsJson.trim()) {
      setUserMessage({ type: "error", text: "Cannot save empty content." });
      return;
    }

    let parsedData: QuizData;
    try {
      // Use parse from jsonc-parser
      const errors: ParseError[] = [];
      parsedData = parse(questionsJson, errors, {
        allowTrailingComma: true,
        disallowComments: false,
      });

      if (errors.length > 0) {
        console.log("JSON parsing errors:", errors);
        setUserMessage({
          type: "error",
          text: `Invalid JSON format: ${JSON.stringify(errors, null, 2)}`,
        });
        return;
      }

      // Validate new format only
      if (!parsedData || typeof parsedData !== 'object') {
        throw new Error("Invalid format: Must be an object with 'title' and 'questions' fields.");
      }

      if (Array.isArray(parsedData)) {
        throw new Error("Invalid format: Old array format is no longer supported. Please use: {\"title\": \"Quiz Title\", \"questions\": [...]}");
      }

      if (!parsedData.questions || !Array.isArray(parsedData.questions)) {
        throw new Error("Invalid format: Missing 'questions' array field.");
      }

      // Backend performs more detailed validation
    } catch (parseError: any) {
      setUserMessage({
        type: "error",
        text: `Invalid JSON format: ${parseError.message}`,
      });
      return;
    }

    setUserMessage(null); // Clear previous messages before saving
    setLengthOfQuestions(parsedData.questions.length);
    saveQuestionsMutation(parsedData); // Trigger the mutation
  }, [questionsJson, saveQuestionsMutation]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check for Ctrl+S (Windows/Linux) or Cmd+S (macOS)
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault(); // Prevent the browser's save dialog
        console.log("Save shortcut pressed!"); // For debugging
        handleSaveChanges();
      }
    };

    // Add the event listener when the component mounts
    window.addEventListener("keydown", handleKeyDown);

    // Remove the event listener when the component unmounts
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleSaveChanges]); // Include any dependencies like the save function

  const handleSetAllWeights = () => {
    const weightValue = parseFloat(commonWeight);
    if (isNaN(weightValue) || weightValue < 0) {
      setUserMessage({
        type: "error",
        text: "Please enter a valid non-negative number for the weight.",
      });
      return;
    }

    try {
      const currentData: QuizData = JSON.parse(questionsJson || '{"questions":[]}');

      // Validate format
      if (Array.isArray(currentData)) {
        setUserMessage({
          type: "error",
          text: "Cannot apply weights: Old array format is no longer supported. Please use: {\"title\": \"Quiz Title\", \"questions\": [...]}",
        });
        return;
      }

      if (!currentData.questions || !Array.isArray(currentData.questions)) {
        setUserMessage({
          type: "error",
          text: "Cannot apply weights: Invalid format. Missing 'questions' array.",
        });
        return;
      }

      currentData.questions = currentData.questions.map((q) => ({
        ...q,
        weight: weightValue,
      }));

      setQuestionsJson(JSON.stringify(currentData, null, 2));
      setUserMessage({
        type: "success",
        text: `All question weights set to ${weightValue}. Remember to save.`,
      });
      setTimeout(() => setUserMessage(null), 3000);
    } catch (parseError: any) {
      setUserMessage({
        type: "error",
        text: `Cannot apply weights: Invalid JSON format - ${parseError.message}`,
      });
    }
  };

  // --- Preview Helpers ---
  type FullQuestion = Question & { correct?: number | number[] };

  const previewParsed = useMemo(() => {
    try {
      const errors: ParseError[] = [];
      const parsed = parse(questionsJson || '{"questions":[]}', errors, {
        allowTrailingComma: true,
        disallowComments: false,
      }) as QuizData | FullQuestion[];
      if (errors.length > 0) {
        return {
          error: `Cannot preview: Invalid JSONC (${errors.length} issue${errors.length > 1 ? "s" : ""}).`,
          qs: null as FullQuestion[] | null,
        };
      }

      // Validate new format only
      let questions: FullQuestion[];
      if (Array.isArray(parsed)) {
        // Old format - no longer supported
        return {
          error: "Cannot preview: Old array format is no longer supported. Please use: {\"title\": \"Quiz Title\", \"questions\": [...]}",
          qs: null
        };
      } else if (parsed && typeof parsed === 'object' && 'questions' in parsed && Array.isArray(parsed.questions)) {
        // New format
        questions = parsed.questions;
      } else {
        return {
          error: "Cannot preview: Invalid format. Expected object with 'title' and 'questions' array.",
          qs: null
        };
      }

      return { error: null as string | null, qs: questions };
    } catch (e: any) {
      return { error: `Cannot preview: ${e?.message || String(e)}`, qs: null as FullQuestion[] | null };
    }
  }, [questionsJson]);

  const getHighlightIndices = (q: FullQuestion): number[] => {
    if (q.type === "single") {
      const c = (q as FullQuestion).correct as number | undefined;
      return typeof c === "number" && c >= 0 ? [c] : [];
    }
    if (q.type === "multiple") {
      const arr = (q as FullQuestion).correct as number[] | undefined;
      return Array.isArray(arr) ? arr.filter((n) => Number.isInteger(n) && n >= 0) : [];
    }
    return [];
  };

  // --- Combined Loading State ---
  // Consider loading if initially fetching OR saving
  const isProcessing = isLoadingQuestions || isSaving || isFetchingQuestions;

  // --- Render Logic ---
  if (adminPassword === null && !userMessage) {
    return <div>Loading editor...</div>;
  }

  // Display error if password prompt was cancelled/failed
  if (userMessage?.type === "error" && adminPassword === null) {
    return <div className="text-red-500 font-bold p-4">{userMessage.text}</div>;
  }

  // Display general loading indicator if fetching for the first time
  if (isLoadingQuestions && !questionsData) {
    return <div className="p-4">Loading questions...</div>;
  }

  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-start items-center mb-2">
        {/* Reduced bottom margin */}
        <button
          onClick={() => {
            navigate("/admin/dashboard", {
              state: { adminPassword: adminPassword },
            });
          }}
          className="px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Go to admin dashboard
        </button>
      </div>
      <h2 className="text-2xl font-bold mb-4">
        Question Editor
        {quizTitle && <span className="text-gray-600 font-normal"> - {quizTitle}</span>}
      </h2>

      {/* Error/Success Messages */}
      {/* Display loading errors */}
      {isLoadError && (
        <div
          className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4"
          role="alert"
        >
          Load failed: {loadError?.message || "Unknown error"}
        </div>
      )}
      {/* Display saving errors */}
      {isSaveError &&
        !isSaving && ( // Show save error only when not actively saving
          <div
            className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4"
            role="alert"
          >
            Save failed: {saveError?.message || "Unknown error"}
          </div>
        )}
      {/* Display success/user messages */}
      {userMessage && (
        <div
          className={`border px-4 py-3 rounded relative mb-4 ${userMessage.type === "success" ? "bg-green-100 border-green-400 text-green-700" : "bg-yellow-100 border-yellow-400 text-yellow-700"}`}
          role="alert"
        >
          {userMessage.text}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-4 mb-4">
        <button
          onClick={() => refetchQuestions()} // Use refetch from useQuery
          disabled={isProcessing || !adminPassword}
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
        >
          {isFetchingQuestions ? "Refreshing..." : "Refresh Questions"}
        </button>
        <button
          title="⌘s or <ctrl-s> to save"
          onClick={handleSaveChanges}
          disabled={isProcessing || !adminPassword} // Disable if loading or saving
          className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Save Changes"}
        </button>
        <button
          onClick={() => setShowPreview((v) => !v)}
          disabled={isLoadingQuestions}
          className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
        >
          {showPreview ? "Hide Preview" : "Preview All Questions"}
        </button>
        <p>Total Questions: {lengthOfQuestions}</p>
      </div>

      {/* Batch Weight Setting */}
      <div className="mb-4 p-4 border rounded bg-gray-50">
        {/* ... (Batch weight UI remains the same) ... */}
        <h3 className="text-lg font-semibold mb-2">Batch Operations</h3>
        <div className="flex items-center gap-2">
          <label
            htmlFor="commonWeight"
            className="block text-sm font-medium text-gray-700"
          >
            Set all weights to:
          </label>
          <input
            type="number"
            id="commonWeight"
            value={commonWeight}
            onChange={(e) => setCommonWeight(e.target.value)}
            min="1"
            step="1"
            className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-24 sm:text-sm border-gray-300 rounded-md p-1"
            disabled={isProcessing}
          />
          <button
            onClick={handleSetAllWeights}
            disabled={isProcessing || !adminPassword}
            className="bg-yellow-500 hover:bg-yellow-700 text-white font-bold py-1 px-3 rounded text-sm disabled:opacity-50"
          >
            Apply Weights
          </button>
        </div>
      </div>

      {/* JSON Editor Area */}
      <textarea
        value={questionsJson}
        onChange={(e) => setQuestionsJson(e.target.value)}
        disabled={isProcessing || !adminPassword || isLoadingQuestions} // Disable during load/save
        placeholder={
          isLoadingQuestions
            ? "Loading questions..."
            : isLoadError
              ? "Error loading questions. Check console."
              : "Edit questions JSON here..."
        }
        rows={25}
        className="w-full p-2 border rounded font-mono text-sm bg-gray-50 disabled:opacity-70"
        spellCheck="false"
      />

      {/* Preview Area */}
      {showPreview && (
        <div className="mt-6 p-4 border rounded bg-white">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xl font-semibold">Preview (answers highlighted)</h3>
            <span className="text-sm text-gray-500">Green = correct answer</span>
          </div>
          {previewParsed.error ? (
            <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-3 py-2 rounded mb-3">
              {previewParsed.error}
            </div>
          ) : null}
          {(() => {
            const qs = previewParsed.qs;
            if (!qs) return null;
            if (qs.length === 0)
              return <div className="text-gray-600">No questions to preview.</div>;
            return (
              <div className="space-y-6">
                {qs.map((q, idx) => (
                  <div key={q.id ?? idx} className="p-4 border rounded">
                    <div className="mb-2 text-sm text-gray-600">ID: {String(q.id)}</div>
                    <QuestionDisplay
                      question={q as Question}
                      currentAnswer={null}
                      onAnswerChange={() => { }}
                      readOnly
                      highlightIndices={getHighlightIndices(q)}
                    />
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* Optional persistent processing indicator */}
      {isProcessing && <div className="mt-2 text-blue-600">Processing...</div>}
    </div>
  );
};

export default QuestionEditor;
