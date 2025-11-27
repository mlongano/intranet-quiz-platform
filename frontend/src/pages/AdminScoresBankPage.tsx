// frontend/src/pages/AdminScoresBankPage.tsx
import { useState, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import {
  fetchScoresBankFiles,
  loadScoresFromBank,
  saveScoresToBank,
  fetchPreviewScoresBankFile,
  deleteScoresFromBank,
  BankOperationResponse,
  ScoresBankFilesResponse,
  ScoreEntry, // Import the ScoreEntry type for preview content
  fetchAdminQuestions,
  QuizData,
  getScoresDownloadUrl,
  renameScoresInBank, // New import for rename
} from "../api"; // Assuming api.ts is in src/
import { slugify } from "../lib/utils";

// Define the name of the scores bank folder for display purposes
const SCORES_BANK_FOLDER = "scores_bank"; // Or import if defined elsewhere

function AdminScoresBankPage() {
  // RETRIEVE PASSWORD USING useLocation STATE AS PER YOUR CODE'S PATTERN (NOTE: INSECURE)
  const location = useLocation();
  const navigate = useNavigate();

  const adminPassword = location.state?.adminPassword;

  const [saveFilename, setSaveFilename] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [previewingFile, setPreviewingFile] = useState<string | null>(null); // State to track which file is being previewed
  const [deleteConfirmFile, setDeleteConfirmFile] = useState<string | null>(null); // Track which file is awaiting delete confirmation
  const [renameTargetFile, setRenameTargetFile] = useState<string | null>(null); // Track which file is being renamed
  const [newFilename, setNewFilename] = useState(""); // State for the new filename input

  const queryClient = useQueryClient(); // Get Query Client instance

  // --- Fetch current quiz data to get the title ---
  const { data: currentQuizData } = useQuery<QuizData, Error>({
    queryKey: ["adminQuestions", adminPassword],
    queryFn: () => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      return fetchAdminQuestions(adminPassword);
    },
    enabled: !!adminPassword,
    staleTime: 5 * 60 * 1000,
  });

  // Generate default filename based on current quiz title
  const defaultFilename = useMemo(() => {
    const now = new Date();
    // Format: 2025-10-25_20-56
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const datePrefix = `${year}-${month}-${day}_${hours}-${minutes}`;

    if (currentQuizData?.title) {
      const slug = slugify(currentQuizData.title);
      return `${datePrefix}_risultati_${slug}.jsonc`;
    }
    return `${datePrefix}_risultati_quiz.jsonc`;
  }, [currentQuizData?.title]);

  // Pre-fill the filename input when default changes
  useMemo(() => {
    if (defaultFilename) {
      setSaveFilename(defaultFilename);
    }
  }, [defaultFilename]);

  // --- Fetch list of files in the scores_bank using React Query ---
  const {
    data: bankFilesData,
    isLoading: isLoadingFiles,
    error: filesError,
  } = useQuery<ScoresBankFilesResponse, Error>({
    // Specify types for data and error
    queryKey: ["scoresBankFiles", adminPassword], // Query key, include password
    queryFn: () => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      setMessage(null); // Clear messages on new fetch attempt
      setError(null); // Clear previous errors
      return fetchScoresBankFiles(adminPassword); // Call your API function
    },
    enabled: !!adminPassword, // Only run this query if adminPassword exists
  });

  // --- Mutation for Loading a file from the scores bank ---
  const loadFileMutation = useMutation<BankOperationResponse, Error, string>({
    // Specify types: result, error, variables (filename)
    mutationFn: (filename: string) => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      setError(null);
      setMessage(null);
      setPreviewingFile(null); // Close preview when loading
      return loadScoresFromBank(filename, adminPassword); // Call your API function
    },
    onSuccess: (data) => {
      setMessage(data.message || "Scores file loaded successfully!");
      // Invalidate or refetch queries that depend on the active scores if needed (e.g., AdminScoresPage)
      queryClient.invalidateQueries({ queryKey: ["scores", adminPassword] });
    },
    onError: (err: any) => {
      setError(`Failed to load scores file: ${err.message}`);
    },
    onSettled: () => {
      // Optional: Refetch file list if needed
      // refetchFiles(); // Not strictly needed for load, as bank contents don't change
    },
  });

  // --- Mutation for Saving the current scores file to the bank ---
  const saveFileMutation = useMutation<BankOperationResponse, Error, string>({
    // Specify types: result, error, variables (suffix)
    mutationFn: (filename_suffix: string) => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      setError(null);
      setMessage(null);
      return saveScoresToBank(filename_suffix, adminPassword); // Call your API function
    },
    onSuccess: (data) => {
      setMessage(data.message || "Scores file saved successfully!");
      // Clear input on success - will be reset to default on next render
      setSaveFilename("");
      // Refetch the list of scores bank files after saving
      queryClient.invalidateQueries({ queryKey: ["scoresBankFiles"] }); // Invalidate to refetch
    },
    onError: (err: any) => {
      setError(`Failed to save scores file: ${err.message}`);
    },
  });

  // --- Mutation for Deleting a file from the scores bank ---
  const deleteFileMutation = useMutation<BankOperationResponse, Error, string>({
    mutationFn: (filename: string) => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      setError(null);
      setMessage(null);
      return deleteScoresFromBank(filename, adminPassword);
    },
    onSuccess: (data) => {
      setMessage(data.message || "Scores file deleted successfully!");
      setDeleteConfirmFile(null); // Reset confirmation state
      // Refetch the list of scores bank files after deleting
      queryClient.invalidateQueries({ queryKey: ["scoresBankFiles"] });
    },
    onError: (err: any) => {
      setError(`Failed to delete scores file: ${err.message}`);
      setDeleteConfirmFile(null); // Reset confirmation state even on error
    },
  });


  // --- Mutation for Renaming a file in the bank ---
  const renameFileMutation = useMutation<BankOperationResponse, Error, { filename: string; newFilename: string }>({
    mutationFn: ({ filename, newFilename }) => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      setError(null);
      setMessage(null);
      return renameScoresInBank(filename, newFilename, adminPassword);
    },
    onSuccess: (data, variables) => {
      setRenameTargetFile(null); // Close rename UI
      setNewFilename(""); // Reset input
      setMessage(data.message || `File '${variables.filename}' renamed successfully!`);
      queryClient.invalidateQueries({ queryKey: ["scoresBankFiles"] });
    },
    onError: (err: any) => {
      setError(`Failed to rename file: ${err.message}`);
    },
  });

  const handleRenameClick = (filename: string) => {
    setRenameTargetFile(filename);
    setNewFilename(filename); // Pre-fill with current filename
  };

  const submitRename = () => {
    if (!renameTargetFile || !newFilename.trim()) return;

    let finalName = newFilename.trim();
    if (!finalName.endsWith('.jsonc')) {
      finalName += '.jsonc';
    }

    if (finalName === renameTargetFile) {
      setRenameTargetFile(null); // No change
      return;
    }

    renameFileMutation.mutate({ filename: renameTargetFile, newFilename: finalName });
  };

  // --- Query for Previewing a file from the scores bank (triggered on demand) ---
  const {
    data: previewData,
    isLoading: isLoadingPreview,
    error: previewError,
    // refetch: fetchPreview // No manual refetch needed, enabled handles it
  } = useQuery<ScoreEntry[], Error>({
    // Expecting an array of ScoreEntry objects
    queryKey: ["scoresBankFilePreview", previewingFile, adminPassword], // Key includes filename and password
    queryFn: () => {
      if (!previewingFile || !adminPassword) {
        // This query should only run when previewingFile and password exist
        throw new Error("Preview file or password not available.");
      }
      // Clear previous preview errors/messages when starting a new preview
      setError(null);
      setMessage(null);
      return fetchPreviewScoresBankFile(previewingFile, adminPassword); // Call the new API function
    },
    enabled: !!previewingFile && !!adminPassword, // Only enabled when a file is selected for preview AND password is available
    staleTime: Infinity, // Preview data doesn't need to refetch automatically
  });

  // --- Handlers for user interactions ---
  const handleLoadClick = (filename: string) => {
    // Trigger the load mutation
    loadFileMutation.mutate(filename);
  };

  const handleSaveClick = () => {
    // Validate filename
    if (!saveFilename.trim()) {
      setError("Please provide a filename.");
      return;
    }

    // Ensure filename ends with .jsonc
    let finalFilename = saveFilename.trim();
    if (!finalFilename.endsWith('.jsonc')) {
      finalFilename += '.jsonc';
    }

    // Trigger the save mutation with the full filename
    saveFileMutation.mutate(finalFilename);
  };

  const handlePreviewClick = (filename: string) => {
    // Toggle previewing the selected file
    if (previewingFile === filename) {
      setPreviewingFile(null); // Hide preview if already showing for this file
      setError(null); // Clear any preview errors
      setMessage(null); // Clear messages
    } else {
      setPreviewingFile(filename); // Set the file to preview, which enables the preview query
      // The query will automatically run because `enabled` becomes true
    }
  };

  // --- Determine loading/error states combined ---
  const isLoading =
    isLoadingFiles ||
    loadFileMutation.isPending ||
    saveFileMutation.isPending ||
    deleteFileMutation.isPending ||
    renameFileMutation.isPending ||
    isLoadingPreview;
  const currentError =
    error ||
    filesError ||
    loadFileMutation.error ||
    saveFileMutation.error ||
    deleteFileMutation.error ||
    renameFileMutation.error ||
    previewError;

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
      <h1 className="text-2xl font-bold mb-4">Scores Bank File Management</h1>

      {/* Message if password is not available */}
      {!adminPassword && (
        <div className="text-red-500 mb-4">
          Admin password not provided via navigation state. Please log in via
          the admin login page.
        </div>
      )}

      {/* Display any errors */}
      {currentError && (
        <div className="text-red-500 mb-4">
          Error:{" "}
          {typeof currentError === "string"
            ? currentError
            : currentError.message || "An unknown error occurred."}
        </div>
      )}
      {/* Display any success messages */}
      {message && <div className="text-green-500 mb-4">{message}</div>}

      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">
          Save Current Scores to Bank
        </h2>
        {currentQuizData?.title && (
          <p className="text-sm text-gray-600 mb-2">
            Quiz title: <span className="font-medium">"{currentQuizData.title}"</span>
          </p>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Enter filename (e.g., 2025-10-25_20-56_risultati_quiz-title.jsonc)"
            className="border p-2 flex-grow font-mono text-sm"
            value={saveFilename}
            onChange={(e) => setSaveFilename(e.target.value)}
            disabled={isLoading || !adminPassword}
          />
          <button
            onClick={handleSaveClick}
            className="bg-green-500 text-white p-2 px-4 rounded disabled:bg-gray-400 whitespace-nowrap"
            disabled={isLoading || !adminPassword || !saveFilename.trim()}
          >
            {saveFileMutation.isPending ? "Saving..." : "Save"}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          You can edit the filename. The .jsonc extension will be added automatically if missing.
        </p>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-2">
          Available Scores Files in Bank
        </h2>
        {isLoadingFiles ? (
          <p>Loading available files...</p>
        ) : bankFilesData?.files && bankFilesData.files.length > 0 ? (
          <ul>
            {bankFilesData.files.map((filename) => (
              <li key={filename} className="border-b mb-2 pb-2">
                <div className="flex justify-between items-center mb-2">
                  {renameTargetFile === filename ? (
                    <div className="flex items-center gap-2 flex-grow mr-2">
                      <input
                        type="text"
                        value={newFilename}
                        onChange={(e) => setNewFilename(e.target.value)}
                        className="border p-1 text-sm flex-grow rounded"
                        autoFocus
                      />
                      <button
                        onClick={submitRename}
                        className="bg-green-500 text-white px-2 py-1 text-xs rounded"
                        disabled={renameFileMutation.isPending}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setRenameTargetFile(null)}
                        className="bg-gray-500 text-white px-2 py-1 text-xs rounded"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <span>{filename}</span>
                  )}

                  <div>
                    {renameTargetFile !== filename && (
                      <>
                        <button
                          onClick={() => handlePreviewClick(filename)}
                          className="bg-blue-500 text-white p-1 text-sm rounded mr-2 disabled:bg-gray-400"
                          disabled={
                            isLoadingFiles || isLoadingPreview || !adminPassword
                          }
                        >
                          {previewingFile === filename && isLoadingPreview
                            ? "Loading Preview..."
                            : previewingFile === filename
                              ? "Hide Preview"
                              : "Preview"}
                        </button>
                        <button
                          onClick={() => handleLoadClick(filename)}
                          className="bg-yellow-500 text-white p-1 text-sm rounded mr-2 disabled:bg-gray-400"
                          disabled={isLoading || !adminPassword}
                        >
                          {loadFileMutation.isPending &&
                            loadFileMutation.variables === filename
                            ? "Loading..."
                            : "Load"}
                        </button>
                        <button
                          onClick={() => handleRenameClick(filename)}
                          className="bg-indigo-500 text-white p-1 text-sm rounded mr-2 disabled:bg-gray-400"
                          disabled={isLoading || !adminPassword}
                        >
                          Rename
                        </button>
                        <a
                          href={getScoresDownloadUrl(filename, adminPassword || "")}
                          className="bg-green-600 text-white p-1 text-sm rounded mr-2 inline-block disabled:bg-gray-400 disabled:pointer-events-none"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Download
                        </a>
                        {/* Delete Button with Inline Confirmation */}
                        {deleteConfirmFile === filename ? (
                          <span className="inline-flex items-center gap-1 bg-yellow-50 px-2 py-1 rounded border border-yellow-300 ml-2">
                            <span className="text-yellow-700 text-xs font-semibold">Delete?</span>
                            <button
                              onClick={() => deleteFileMutation.mutate(filename)}
                              className="bg-red-600 text-white px-2 py-0.5 text-xs rounded hover:bg-red-700 disabled:opacity-50"
                              disabled={deleteFileMutation.isPending}
                            >
                              {deleteFileMutation.isPending ? "Deleting..." : "Yes"}
                            </button>
                            <button
                              onClick={() => setDeleteConfirmFile(null)}
                              className="bg-gray-500 text-white px-2 py-0.5 text-xs rounded hover:bg-gray-600 disabled:opacity-50"
                              disabled={deleteFileMutation.isPending}
                            >
                              No
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirmFile(filename)}
                            className="bg-red-500 text-white p-1 text-sm rounded disabled:bg-gray-400"
                            disabled={isLoading || !adminPassword}
                          >
                            Delete
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {/* --- Preview Area --- */}
                {previewingFile === filename &&
                  !isLoadingPreview &&
                  previewData && (
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-300 max-h-[70vh] overflow-y-auto">
                      <h3 className="font-semibold mb-4 text-lg">Preview: {filename}</h3>
                      {/* Rendering scores in a formatted table */}
                      {previewData.length > 0 ? (
                        <div className="space-y-6">
                          {previewData.map((entry, idx) => (
                            <div key={idx} className="bg-white p-4 rounded-lg border shadow-sm">
                              {/* Student Header */}
                              <div className="border-b pb-2 mb-3">
                                <h4 className="text-lg font-semibold text-gray-800">
                                  Student: {entry.student}
                                </h4>
                                <p className="text-sm text-gray-500">
                                  Quiz ID: {entry.quiz_id}
                                  {entry.quiz_title && <span className="ml-2">({entry.quiz_title})</span>}
                                </p>
                                <p className="text-sm text-gray-600 font-medium">
                                  Score: {entry.raw_points} / {entry.max_points} ({entry.percent}%)
                                </p>
                                <p className="text-xs text-gray-400">
                                  Submitted: {new Date(entry.timestamp + 'Z').toLocaleString()}
                                </p>
                              </div>

                              {/* Answers List */}
                              <div className="space-y-3">
                                {entry.answers.map((ans, ansIdx) => (
                                  <div key={ansIdx} className="p-3 bg-gray-50 rounded border">
                                    {/* Question */}
                                    <div className="font-semibold text-gray-800 mb-2">
                                      <span className="mr-2">{ansIdx + 1}.</span>
                                      <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        rehypePlugins={[rehypeSanitize]}
                                        className="inline"
                                      >
                                        {ans.question_text || ""}
                                      </ReactMarkdown>
                                      <span className="text-xs text-gray-400 ml-2">
                                        (ID: {ans.question_id})
                                      </span>
                                    </div>

                                    {ans.question_image && (
                                      <img
                                        src={ans.question_image}
                                        alt={`Question ${ansIdx + 1}`}
                                        className="w-40 max-w-sm mx-auto my-2 rounded"
                                      />
                                    )}

                                    {/* Student Answer */}
                                    <div className="ml-4 mb-2 text-sm flex items-start gap-2">
                                      <span className="font-medium text-gray-600">Answer:</span>
                                      <span className="font-mono bg-gray-100 px-2 py-1 rounded text-xs">
                                        {JSON.stringify(ans.student_answer)}
                                      </span>
                                      {ans.points_awarded === ans.weight && (
                                        <span className="text-green-700 font-bold text-lg">✓</span>
                                      )}
                                      {ans.points_awarded > 0 && ans.points_awarded < ans.weight && (
                                        <span className="text-yellow-500 font-bold text-lg">⚠</span>
                                      )}
                                      {ans.points_awarded === 0 && (
                                        <span className="text-red-700 font-bold text-lg">❌</span>
                                      )}
                                    </div>

                                    {/* Correct Answer */}
                                    <div className="ml-4 mb-2 text-sm flex items-start gap-2">
                                      <span className="font-medium text-green-700">Correct:</span>
                                      <span className="font-mono bg-green-50 px-2 py-1 rounded text-xs">
                                        {JSON.stringify(ans.correct_answer)}
                                      </span>
                                    </div>

                                    {/* Points */}
                                    <div className="ml-4 text-sm text-gray-700">
                                      <span className="font-medium">
                                        Points: {ans.points_awarded} / {ans.weight}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-gray-600">No score entries found in this file.</p>
                      )}
                    </div>
                  )}
                {/* Show preview loading/error states */}
                {previewingFile === filename && isLoadingPreview && (
                  <p>Loading preview...</p>
                )}
                {previewingFile === filename &&
                  previewError &&
                  !isLoadingPreview && (
                    <div className="text-red-500 mt-2">
                      Error loading preview: {previewError.message}
                    </div>
                  )}
              </li>
            ))}
          </ul>
        ) : (
          !isLoadingFiles &&
          !currentError && (
            <p>
              No scores files found in the '{SCORES_BANK_FOLDER}' directory.
            </p>
          ) // Use SCORES_BANK_FOLDER constant
        )}
      </div>
    </div>
  );
}

export default AdminScoresBankPage;
