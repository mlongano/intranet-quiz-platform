// frontend/src/pages/AdminBankManagerPage.tsx
import { useState, useMemo, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom"; // Import useLocation for password
import {
  fetchQuestionBankFiles,
  loadQuizFromBank,
  saveQuizToBank,
  fetchPreviewBankFile, // We'll add this new API function next
  BankOperationResponse,
  QuestionBankFilesResponse,
  Question, // Import the Question type for preview content
  fetchAdminQuestions,
  QuizData,
} from "../api"; // Assuming api.ts is in src/

function AdminBankManagerPage() {
  // RETRIEVE PASSWORD USING useLocation STATE AS PER YOUR CODE'S PATTERN (NOTE: INSECURE)
  const location = useLocation();
  const navigate = useNavigate();

  const adminPassword = location.state?.adminPassword;

  const [saveFilename, setSaveFilename] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [previewingFile, setPreviewingFile] = useState<string | null>(null); // State to track which file is being previewed
  const [justLoadedFile, setJustLoadedFile] = useState(false); // Track if we just loaded a file to avoid clearing messages

  const queryClient = useQueryClient(); // Get Query Client instance

  // --- Fetch current quiz data to get the title ---
  const { data: currentQuizData, error: questionsError } = useQuery<QuizData, Error>({
    queryKey: ["adminQuestions", adminPassword],
    queryFn: () => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      return fetchAdminQuestions(adminPassword);
    },
    enabled: !!adminPassword,
    staleTime: 5 * 60 * 1000,
    retry: false, // Don't retry on error
  });

  // Handle questionsError changes - ignore error if we just loaded a file
  useEffect(() => {
    if (questionsError && justLoadedFile) {
      // Suppress the questions error when we just loaded a file
      // The load operation's warning/message should remain visible
      console.log("Questions query error suppressed after file load:", questionsError.message);
      // Reset the flag after a brief delay
      const timer = setTimeout(() => setJustLoadedFile(false), 2000);
      return () => clearTimeout(timer);
    } else if (!questionsError && justLoadedFile) {
      // Questions loaded successfully after file load
      setJustLoadedFile(false);
    }
  }, [questionsError, justLoadedFile]);

  // Slugify function to match backend implementation
  const slugify = (text: string): string => {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/[^\w-]+/g, '') // Remove non-word chars except hyphens
      .replace(/--+/g, '-') // Replace multiple hyphens with single hyphen
      .replace(/^-+/, '') // Trim hyphens from start
      .replace(/-+$/, ''); // Trim hyphens from end
  };

  // Generate default filename based on current quiz title
  const defaultFilename = useMemo(() => {
    const now = new Date();
    // Format: 2025-10-25_18-46
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const datePrefix = `${year}-${month}-${day}_${hours}-${minutes}`;

    if (currentQuizData?.title) {
      const slug = slugify(currentQuizData.title);
      return `${datePrefix}_${slug}.jsonc`;
    }
    return `${datePrefix}_quiz.jsonc`;
  }, [currentQuizData?.title]);

  // Pre-fill the filename input when default changes
  useMemo(() => {
    if (defaultFilename) {
      setSaveFilename(defaultFilename);
    }
  }, [defaultFilename]);

  // --- Fetch list of files in the question_bank using React Query ---
  const {
    data: bankFilesData,
    isLoading: isLoadingFiles,
    error: filesError,
    refetch: refetchFiles,
  } = useQuery<QuestionBankFilesResponse, Error>({
    // Specify types for data and error
    queryKey: ["questionBankFiles", adminPassword], // Query key, include password (handle cache if password changes)
    queryFn: () => {
      if (!adminPassword) {
        // If no password, we can't fetch. Throwing will set isError state.
        throw new Error("Admin password not available.");
      }
      // Don't clear messages here - let mutations handle message lifecycle
      return fetchQuestionBankFiles(adminPassword); // Call your API function
    },
    enabled: !!adminPassword, // Only run this query if adminPassword exists
    // staleTime: 5 * 60 * 1000, // Optional: data is considered fresh for 5 minutes
  });

  // --- Mutation for Loading a file from the bank ---
  const loadFileMutation = useMutation<BankOperationResponse, Error, string>({
    // Specify types: result, error, variables (filename)
    mutationFn: (filename: string) => {
      if (!adminPassword) {
        throw new Error("Admin password not available."); // Should not happen if button is disabled
      }
      setError(null); // Clear errors before mutation
      setWarning(null); // Clear warnings before mutation
      setMessage(null); // Clear messages before mutation
      console.log("Loading quiz from bank:", filename);
      return loadQuizFromBank(filename, adminPassword); // Call your API function
    },
    retry: false, // Don't retry on error
    onSuccess: (data) => {
      console.log("Load success, response:", data);
      setJustLoadedFile(true); // Mark that we just loaded a file
      if (data.warning) {
        // Show warning if present
        console.log("Setting warning:", data.warning);
        setWarning(data.warning);
      }
      setMessage(data.message || "File loaded successfully!");
      // Invalidate query for the active questions so it refetches with the new data
      queryClient.invalidateQueries({ queryKey: ["adminQuestions"] });
    },
    onError: (err: any) => {
      console.error("Load error:", err);
      setError(`Failed to load file: ${err.message}`);
    },
    onSettled: () => {
      // Optional: Refetch file list just in case (e.g., if load creates backups)
      refetchFiles();
    },
  });

  // --- Mutation for Saving the current file to the bank ---
  const saveFileMutation = useMutation<BankOperationResponse, Error, string>({
    // Specify types: result, error, variables (suffix)
    mutationFn: (filename_suffix: string) => {
      if (!adminPassword) {
        throw new Error("Admin password not available."); // Should not happen if button is disabled
      }
      setError(null); // Clear errors before mutation
      setWarning(null); // Clear warnings before mutation
      setMessage(null); // Clear messages before mutation
      return saveQuizToBank(filename_suffix, adminPassword); // Call your API function
    },
    onSuccess: (data) => {
      setMessage(data.message || "File saved successfully!");
      // Clear input on success - will be reset to default on next render
      setSaveFilename("");
      // Refetch the list of bank files after saving
      queryClient.invalidateQueries({ queryKey: ["questionBankFiles"] }); // Invalidate to refetch
    },
    onError: (err: any) => {
      setError(`Failed to save file: ${err.message}`);
    },
  });

  // --- Query for Previewing a file from the bank (triggered on demand) ---
  const {
    data: previewData,
    isLoading: isLoadingPreview,
    error: previewError, // Function to manually trigger the preview fetch
  } = useQuery<Question[], Error>({
    // Expecting an array of Question objects
    queryKey: ["quizBankFilePreview", previewingFile, adminPassword], // Key includes filename and password
    queryFn: () => {
      if (!previewingFile || !adminPassword) {
        // This query should only run when previewingFile and password exist
        throw new Error("Preview file or password not available.");
      }
      // Don't clear messages here - preview is informational and shouldn't affect load/save messages
      return fetchPreviewBankFile(previewingFile, adminPassword); // Call the new API function
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
      setWarning(null); // Clear any warnings
      setMessage(null); // Clear messages
    } else {
      setPreviewingFile(filename); // Set the file to preview, which enables the preview query
      setError(null); // Clear any errors
      setWarning(null); // Clear any warnings
      setMessage(null); // Clear messages
      // The query will automatically run because `enabled` becomes true
    }
  };

  // --- Determine loading/error states combined ---
  const isLoading =
    isLoadingFiles ||
    loadFileMutation.isPending ||
    saveFileMutation.isPending ||
    isLoadingPreview;
  const currentError =
    error ||
    filesError ||
    loadFileMutation.error ||
    saveFileMutation.error ||
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

      <h1 className="text-2xl font-bold mb-4">Question Bank File Management</h1>

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
          Error:
          {typeof currentError === "string"
            ? currentError
            : currentError.message || "An unknown error occurred."}
        </div>
      )}

      {/* Display questions loading error */}
      {questionsError && !currentError && !justLoadedFile && (
        <div className="text-red-500 mb-4">
          Error loading current quiz: {questionsError.message}
        </div>
      )}

      {/* Display any warnings */}
      {warning && (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-4">
          <p className="font-bold">Warning</p>
          <p>{warning}</p>
        </div>
      )}

      {/* Display any success messages */}
      {message && <div className="text-green-500 mb-4">{message}</div>}

      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">
          Save Current Quiz to Bank
        </h2>
        {currentQuizData?.title && (
          <p className="text-sm text-gray-600 mb-2">
            Quiz title: <span className="font-medium">"{currentQuizData.title}"</span>
          </p>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Enter filename (e.g., 20251025_123456_quiz-title.jsonc)"
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
          Available Quiz Files in Bank
        </h2>
        {isLoadingFiles ? (
          <p>Loading available files...</p>
        ) : bankFilesData?.files && bankFilesData.files.length > 0 ? (
          <ul>
            {bankFilesData.files.map((filename) => (
              <li key={filename} className="border-b mb-2 pb-2">
                <div className="flex justify-between items-center mb-2">
                  <span>{filename}</span>
                  <div>
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
                      className="bg-yellow-500 text-white p-1 text-sm rounded disabled:bg-gray-400"
                      disabled={isLoading || !adminPassword}
                    >
                      {loadFileMutation.isPending &&
                        loadFileMutation.variables === filename
                        ? "Loading..."
                        : "Load"}
                    </button>
                  </div>
                </div>
                {/* --- Preview Area --- */}
                {previewingFile === filename &&
                  !isLoadingPreview &&
                  previewData && (
                    <div className="bg-gray-100 p-3 rounded text-sm max-h-60 overflow-y-auto">
                      <h3 className="font-semibold mb-2">Preview:</h3>
                      {/* Basic rendering of questions for preview */}
                      {previewData.length > 0 ? (
                        previewData.map((q, index) => (
                          <div
                            key={q.id || index}
                            className="mb-2 pb-2 border-b border-gray-300 last:border-b-0"
                          >
                            <p>
                              <strong>ID:</strong> {q.id}
                            </p>
                            <p>
                              <strong>Type:</strong> {q.type}
                            </p>
                            <p>
                              <strong>Weight:</strong> {q.weight}
                            </p>
                            <div>
                              <strong>Text:</strong>
                              <div className="mt-1 text-gray-900">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  rehypePlugins={[rehypeSanitize]}
                                >
                                  {q.text || ""}
                                </ReactMarkdown>
                              </div>
                            </div>
                            {/* Displaying options and correct answers for preview might require more detailed rendering logic based on your Question type */}
                            {q.options && q.options.length > 0 && (
                              <div>
                                <strong>Options:</strong>
                                <ul>
                                  {q.options.map((opt, optIndex) => (
                                    <li key={optIndex} className="ml-4">
                                      {/* Handle options being string or OptionObject */}
                                      <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        rehypePlugins={[rehypeSanitize]}
                                      >
                                        {typeof opt === "string" ? opt : opt.text || ""}
                                      </ReactMarkdown>
                                      {/* Add image preview if applicable, needs styling */}
                                      {typeof opt !== "string" && opt.image && (
                                        <img
                                          src={opt.image}
                                          alt="Option image preview"
                                          className="inline-block h-8 w-8 object-cover ml-2 rounded"
                                        />
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {/* Display correct answer (simplified for preview) */}
                            {"correct" in q && (
                              <p>
                                <strong>Correct:</strong>{" "}
                                {JSON.stringify(q.correct)}
                              </p> // Display raw correct data for admin preview
                            )}
                            {q.question_image && (
                              <div>
                                <strong>Question Image:</strong>
                                <img
                                  src={q.question_image}
                                  alt="Question image preview"
                                  className="max-h-24 object-cover mt-1 rounded"
                                />
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        <p>No questions found in this file.</p>
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
            <p>No quiz files found in the questionbank_folder directory.</p>
          ) // Use QUESTION_BANK_FOLDER constant
        )}
      </div>
    </div>
  );
}

export default AdminBankManagerPage;
