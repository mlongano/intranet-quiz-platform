// frontend/src/components/QuestionEditor.tsx (React Query Version)

import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchAdminQuestions, updateAdminQuestions, Question } from "../api"; // Adjust path if needed
import { useLocation } from "react-router-dom";

const QuestionEditor: React.FC = () => {
  const location = useLocation();
  // Attempt to get password from navigation state (insecure, lost on refresh)
  const adminPassword = location.state?.adminPassword;
  // Local state for the editable JSON string and password
  const [questionsJson, setQuestionsJson] = useState<string>("");
  const [commonWeight, setCommonWeight] = useState<string>("1");
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
  } = useQuery<Question[], Error>({
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
      setUserMessage(null); // Clear message on successful load/update
    } else if (!isLoadingQuestions && adminPassword) {
      // Handle case where data is null/undefined after loading finishes (e.g., if API returns empty successfully)
      setQuestionsJson("[]"); // Set to empty array string
    }
  }, [questionsData, isLoadingQuestions, adminPassword]);

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
    Question[] // Type of variables passed to the mutation function
  >({
    mutationFn: (updatedQuestions: Question[]) => {
      if (!adminPassword) {
        return Promise.reject(new Error("Password not available for saving"));
      }
      return updateAdminQuestions(updatedQuestions, adminPassword);
    },
    onSuccess: (data) => {
      // Invalidate the questions query cache to trigger a refetch
      queryClient.invalidateQueries({ queryKey: queryKey });
      // Set success message from API response or a default one
      setUserMessage({
        type: "success",
        text: data.message || "Questions saved successfully!",
      });
      // Optionally clear local JSON or rely on refetch to update it
    },
    onError: (err) => {
      // Error message is handled via isSaveError/saveError state
      setUserMessage({ type: "error", text: `Save failed: ${err.message}` });
    },
  });

  // --- Event Handlers ---
  const handleSaveChanges = () => {
    if (!questionsJson.trim()) {
      setUserMessage({ type: "error", text: "Cannot save empty content." });
      return;
    }

    let parsedQuestions: Question[];
    try {
      parsedQuestions = JSON.parse(questionsJson);
      if (!Array.isArray(parsedQuestions)) {
        throw new Error("Invalid format: Questions data must be an array.");
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
    saveQuestionsMutation(parsedQuestions); // Trigger the mutation
  };

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
      let currentQuestions: Question[] = JSON.parse(questionsJson || "[]");
      if (!Array.isArray(currentQuestions)) {
        setUserMessage({
          type: "error",
          text: "Cannot apply weights: Current content is not a valid JSON array.",
        });
        return;
      }

      currentQuestions = currentQuestions.map((q) => ({
        ...q,
        weight: weightValue,
      }));

      setQuestionsJson(JSON.stringify(currentQuestions, null, 2));
      setUserMessage({
        type: "success",
        text: `All question weights set to ${weightValue}. Remember to save.`,
      });
    } catch (parseError: any) {
      setUserMessage({
        type: "error",
        text: `Cannot apply weights: Invalid JSON format - ${parseError.message}`,
      });
    }
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
      <h2 className="text-2xl font-bold mb-4">Question Editor</h2>

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
          onClick={handleSaveChanges}
          disabled={isProcessing || !adminPassword} // Disable if loading or saving
          className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Save Changes"}
        </button>
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

      {/* Optional persistent processing indicator */}
      {isProcessing && <div className="mt-2 text-blue-600">Processing...</div>}
    </div>
  );
};

export default QuestionEditor;
