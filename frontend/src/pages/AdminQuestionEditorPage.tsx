// frontend/src/components/QuestionEditorPage.tsx (React Query Version)

import React, { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { parse, ParseError } from "jsonc-parser"; // Import parse from jsonc-parser

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchAdminQuestions, updateAdminQuestions, QuizData, Question, clearActiveQuizImages, listQuizImages } from "../api"; // Import both QuizData and Question
import { useLocation, useNavigate } from "react-router-dom";
import QuestionDisplay from "../components/QuestionDisplay";
import { ImagePicker } from "../components/ImagePicker";
const JsonSafeField = React.lazy(() => import("../components/JsonSafeField"));

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
  const [showImagePicker, setShowImagePicker] = useState<boolean>(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
  // Toast notification state
  const [toast, setToast] = useState<{
    type: "success" | "error" | "warning";
    text: string;
  } | null>(null);

  const showToast = useCallback((type: "success" | "error" | "warning", text: string, duration = 3000) => {
    setToast({ type, text });
    if (duration > 0) {
      setTimeout(() => setToast(null), duration);
    }
  }, []);

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

  // --- Fetch Images List using useQuery ---
  const { data: imagesData } = useQuery({
    queryKey: ["quizImages", "questions.jsonc", adminPassword],
    queryFn: () => {
      if (!adminPassword) {
        return Promise.reject(new Error("Password not available"));
      }
      return listQuizImages("questions.jsonc", adminPassword);
    },
    enabled: !!adminPassword,
    staleTime: 30 * 1000, // Refetch every 30 seconds
    refetchOnWindowFocus: false,
  });

  const imageCount = imagesData?.length || 0;

  // Effect to update the local JSON state when query data changes
  useEffect(() => {
    if (questionsData) {
      setQuestionsJson(JSON.stringify(questionsData, null, 2));

      // Check if there's a warning about invalid format
      if (questionsData.warning) {
        showToast("warning", questionsData.warning, 0); // Don't auto-clear warnings
      } else {
        showToast("success", "Questions loaded successfully", 2000);
      }

      setLengthOfQuestions(questionsData.questions?.length || 0);
    } else if (!isLoadingQuestions && adminPassword) {
      // Handle case where data is null/undefined after loading finishes (e.g., if API returns empty successfully)
      setQuestionsJson(JSON.stringify({ title: "", questions: [] }, null, 2)); // Set to empty quiz data
    }
  }, [questionsData, isLoadingQuestions, adminPassword, showToast]);

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
      showToast("success", data.message || "Questions saved successfully!", 2000);
      // Optionally clear local JSON or rely on refetch to update it
    },
    onError: (err) => {
      // Error message is handled via isSaveError/saveError state
      showToast("error", `Save failed: ${err.message}`);
    },
  });

  // --- Clear Active Quiz Images using useMutation ---
  const {
    mutate: clearImagesMutation,
    isPending: isClearingImages,
  } = useMutation<
    { success: boolean; message: string; deleted_count: number },
    Error,
    void
  >({
    mutationFn: () => {
      if (!adminPassword) {
        return Promise.reject(new Error("Password not available"));
      }
      return clearActiveQuizImages(adminPassword);
    },
    onSuccess: (data) => {
      setShowClearConfirm(false);
      showToast("success", data.message, 3000);
      // Invalidate images query to update the count
      queryClient.invalidateQueries({ queryKey: ["quizImages"] });
    },
    onError: (err) => {
      setShowClearConfirm(false);
      showToast("error", `Failed to clear images: ${err.message}`, 3000);
    },
  });

  // --- Event Handlers ---
  const handleSaveChanges = useCallback(() => {
    if (!questionsJson.trim()) {
      showToast("error", "Cannot save empty content.");
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
        showToast("error", `Invalid JSON format: ${JSON.stringify(errors, null, 2)}`);
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
      showToast("error", `Invalid JSON format: ${parseError.message}`);
      return;
    }

    setLengthOfQuestions(parsedData.questions.length);
    saveQuestionsMutation(parsedData); // Trigger the mutation
  }, [questionsJson, saveQuestionsMutation, showToast]);

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
      showToast("error", "Please enter a valid non-negative number for the weight.");
      return;
    }

    try {
      const currentData: QuizData = JSON.parse(questionsJson || '{"questions":[]}');

      // Validate format
      if (Array.isArray(currentData)) {
        showToast("error", "Cannot apply weights: Old array format is no longer supported. Please use: {\"title\": \"Quiz Title\", \"questions\": [...]}");
        return;
      }

      if (!currentData.questions || !Array.isArray(currentData.questions)) {
        showToast("error", "Cannot apply weights: Invalid format. Missing 'questions' array.");
        return;
      }

      currentData.questions = currentData.questions.map((q) => ({
        ...q,
        weight: weightValue,
      }));

      setQuestionsJson(JSON.stringify(currentData, null, 2));
      showToast("success", `All question weights set to ${weightValue}. Remember to save.`, 3000);
    } catch (parseError: any) {
      showToast("error", `Cannot apply weights: Invalid JSON format - ${parseError.message}`);
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
  if (adminPassword === null && !toast) {
    return <div>Loading editor...</div>;
  }

  // Display error if password prompt was cancelled/failed
  if (toast?.type === "error" && adminPassword === null) {
    return <div className="text-red-500 font-bold p-4">{toast.text}</div>;
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

      {/* Error/Success Messages - Keep persistent errors visible */}
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
        <button
          onClick={() => setShowImagePicker(true)}
          disabled={!adminPassword || !quizTitle}
          className="bg-orange-500 hover:bg-orange-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
          title={!quizTitle ? "Save quiz first to manage images" : "Manage quiz images"}
        >
          📷 Manage Images
        </button>
        {!showClearConfirm ? (
          <button
            onClick={() => setShowClearConfirm(true)}
            disabled={isClearingImages || !adminPassword}
            className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
            title="Clear all images from active quiz folder"
          >
            🗑️ Clear Images
          </button>
        ) : (
          <div className="flex gap-2 items-center bg-red-50 px-3 py-2 rounded border border-red-300">
            <div className="flex flex-col gap-1">
              <span className="text-red-700 text-sm font-semibold">Clear all active quiz images?</span>
              <span className="text-red-600 text-xs">
                Deletes all images in questions_images/. Bank quiz images are NOT affected.
              </span>
            </div>
            <button
              onClick={() => {
                clearImagesMutation();
                setShowClearConfirm(false);
              }}
              disabled={isClearingImages}
              className="bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded text-sm disabled:opacity-50 whitespace-nowrap"
            >
              {isClearingImages ? "Clearing..." : "Yes, Clear"}
            </button>
            <button
              onClick={() => setShowClearConfirm(false)}
              disabled={isClearingImages}
              className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-1 px-3 rounded text-sm disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}
        <div className="flex items-center gap-4">
          <p>Total Questions: {lengthOfQuestions}</p>
          {imageCount > 0 && (
            <p className="text-gray-600">
              📷 Images: <span className="font-semibold">{imageCount}</span>
            </p>
          )}
        </div>
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

      {/* Helper: JSON-safe generator + Markdown preview (lazy-loaded) */}
      <div className="mt-4">
        <Suspense fallback={<div className="p-4 bg-gray-100 rounded">Loading helper...</div>}>
          <JsonSafeField />
        </Suspense>
      </div>

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

      {/* Image Picker Modal */}
      {showImagePicker && adminPassword && questionsData && (
        <ImagePicker
          quizFilename={`questions.jsonc`}
          password={adminPassword}
          onSelect={(imagePath) => {
            navigator.clipboard.writeText(imagePath);
            setCopiedPath(imagePath);
            setTimeout(() => setCopiedPath(null), 3000);
          }}
          onClose={() => {
            setShowImagePicker(false);
            // Invalidate images query when closing image picker (user may have uploaded/deleted images)
            queryClient.invalidateQueries({ queryKey: ["quizImages"] });
          }}
        />
      )}

      {/* Copied Path Notification */}
      {copiedPath && (
        <div
          style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            backgroundColor: '#28a745',
            color: 'white',
            padding: '16px 24px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: 2000,
            maxWidth: '500px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '20px' }}>✓</span>
              <strong>Image path copied!</strong>
            </div>
            <div style={{
              fontSize: '14px',
              wordBreak: 'break-all',
              fontFamily: 'monospace',
              backgroundColor: 'rgba(0,0,0,0.2)',
              padding: '8px',
              borderRadius: '4px'
            }}>
              {copiedPath}
            </div>
            <div style={{ fontSize: '12px', opacity: 0.9 }}>
              Paste this path in the JSON editor for "question_image" or option "image" fields
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            backgroundColor: toast.type === 'success' ? '#28a745' : toast.type === 'error' ? '#dc3545' : '#ffc107',
            color: 'white',
            padding: '16px 24px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: 2000,
            maxWidth: '500px',
            animation: 'slideIn 0.3s ease-out',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <span style={{ fontSize: '20px', flexShrink: 0 }}>
              {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : '⚠'}
            </span>
            <span style={{ wordBreak: 'break-word', flex: 1 }}>{toast.text}</span>
            <button
              onClick={() => setToast(null)}
              style={{
                background: 'none',
                border: 'none',
                color: 'white',
                cursor: 'pointer',
                fontSize: '20px',
                padding: '0',
                lineHeight: '1',
                opacity: 0.8,
                flexShrink: 0,
              }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '0.8'}
              title="Close"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuestionEditor;
