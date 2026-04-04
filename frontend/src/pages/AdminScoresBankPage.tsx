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
  ScoreEntry,
  fetchAdminQuestions,
  QuizData,
  getScoresDownloadUrl,
  renameScoresInBank,
} from "../api";
import { slugify } from "../lib/utils";
import AdminLayout from "../layouts/AdminLayout";

// Define the path of the scores bank folder for display purposes
const SCORES_BANK_FOLDER = "banks/scores_bank";

function AdminScoresBankPage() {
  const location = useLocation();
  const navigate = useNavigate();

  const adminPassword = location.state?.adminPassword;

  const [saveFilename, setSaveFilename] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [previewingFile, setPreviewingFile] = useState<string | null>(null);
  const [deleteConfirmFile, setDeleteConfirmFile] = useState<string | null>(null);
  const [renameTargetFile, setRenameTargetFile] = useState<string | null>(null);
  const [newFilename, setNewFilename] = useState("");

  const queryClient = useQueryClient();

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
    queryKey: ["scoresBankFiles", adminPassword],
    queryFn: () => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      setMessage(null);
      setError(null);
      return fetchScoresBankFiles(adminPassword);
    },
    enabled: !!adminPassword,
  });

  // --- Mutation for Loading a file from the scores bank ---
  const loadFileMutation = useMutation<BankOperationResponse, Error, string>({
    mutationFn: (filename: string) => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      setError(null);
      setMessage(null);
      setPreviewingFile(null);
      return loadScoresFromBank(filename, adminPassword);
    },
    onSuccess: (data) => {
      setMessage(data.message || "Scores file loaded successfully!");
      queryClient.invalidateQueries({ queryKey: ["scores", adminPassword] });
    },
    onError: (err: any) => {
      setError(`Failed to load scores file: ${err.message}`);
    },
  });

  // --- Mutation for Saving the current scores file to the bank ---
  const saveFileMutation = useMutation<BankOperationResponse, Error, string>({
    mutationFn: (filename_suffix: string) => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      setError(null);
      setMessage(null);
      return saveScoresToBank(filename_suffix, adminPassword);
    },
    onSuccess: (data) => {
      setMessage(data.message || "Scores file saved successfully!");
      setSaveFilename("");
      queryClient.invalidateQueries({ queryKey: ["scoresBankFiles"] });
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
      setDeleteConfirmFile(null);
      queryClient.invalidateQueries({ queryKey: ["scoresBankFiles"] });
    },
    onError: (err: any) => {
      setError(`Failed to delete scores file: ${err.message}`);
      setDeleteConfirmFile(null);
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
      setRenameTargetFile(null);
      setNewFilename("");
      setMessage(data.message || `File '${variables.filename}' renamed successfully!`);
      queryClient.invalidateQueries({ queryKey: ["scoresBankFiles"] });
    },
    onError: (err: any) => {
      setError(`Failed to rename file: ${err.message}`);
    },
  });

  const handleRenameClick = (filename: string) => {
    setRenameTargetFile(filename);
    setNewFilename(filename);
  };

  const submitRename = () => {
    if (!renameTargetFile || !newFilename.trim()) return;

    let finalName = newFilename.trim();
    if (!finalName.endsWith('.jsonc')) {
      finalName += '.jsonc';
    }

    if (finalName === renameTargetFile) {
      setRenameTargetFile(null);
      return;
    }

    renameFileMutation.mutate({ filename: renameTargetFile, newFilename: finalName });
  };

  // --- Query for Previewing a file from the scores bank ---
  const {
    data: previewData,
    isLoading: isLoadingPreview,
    error: previewError,
  } = useQuery<ScoreEntry[], Error>({
    queryKey: ["scoresBankFilePreview", previewingFile, adminPassword],
    queryFn: () => {
      if (!previewingFile || !adminPassword) {
        throw new Error("Preview file or password not available.");
      }
      setError(null);
      setMessage(null);
      return fetchPreviewScoresBankFile(previewingFile, adminPassword);
    },
    enabled: !!previewingFile && !!adminPassword,
    staleTime: Infinity,
  });

  // --- Handlers for user interactions ---
  const handleLoadClick = (filename: string) => {
    loadFileMutation.mutate(filename);
  };

  const handleSaveClick = () => {
    if (!saveFilename.trim()) {
      setError("Please provide a filename.");
      return;
    }

    let finalFilename = saveFilename.trim();
    if (!finalFilename.endsWith('.jsonc')) {
      finalFilename += '.jsonc';
    }

    saveFileMutation.mutate(finalFilename);
  };

  const handlePreviewClick = (filename: string) => {
    if (previewingFile === filename) {
      setPreviewingFile(null);
      setError(null);
      setMessage(null);
    } else {
      setPreviewingFile(filename);
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
    <AdminLayout
      activePath="/admin/scores-bank"
      adminPassword={adminPassword || ""}
      pageTitle="Scores Bank"
    >
      <div>
        {/* Message if password is not available */}
        {!adminPassword && (
          <div className="bg-error/10 border border-error/30 text-error px-4 py-3 rounded-lg mb-6">
            Admin password not provided via navigation state. Please log in via the admin login page.
          </div>
        )}

        {/* Display any errors */}
        {currentError && (
          <div className="bg-error/10 border border-error/30 text-error px-4 py-3 rounded-lg mb-6">
            Error: {typeof currentError === "string"
              ? currentError
              : currentError.message || "An unknown error occurred."}
          </div>
        )}

        {/* Display any success messages */}
        {message && (
          <div className="bg-tertiary/10 border border-tertiary/30 text-tertiary px-4 py-3 rounded-lg mb-6">
            {message}
          </div>
        )}

        <div className="mb-8 p-6 bg-surface-container border border-outline-variant/20 rounded-xl">
          <h2 className="text-lg font-bold font-headline text-on-surface mb-4">
            Save Current Scores to Bank
          </h2>
          {currentQuizData?.title && (
            <p className="text-sm text-on-surface-variant mb-3">
              Quiz title: <span className="font-medium text-on-surface">"{currentQuizData.title}"</span>
            </p>
          )}
          <div className="flex gap-3 items-start">
            <div className="flex-grow">
              <input
                type="text"
                placeholder="Enter filename (e.g., 2025-10-25_20-56_risultati_quiz-title.jsonc)"
                className="w-full p-3 bg-surface-container-low border border-outline-variant/30 text-on-surface focus:border-primary/50 focus:outline-none rounded-lg placeholder:text-outline-variant/50 font-mono text-sm"
                value={saveFilename}
                onChange={(e) => setSaveFilename(e.target.value)}
                disabled={isLoading || !adminPassword}
              />
              <p className="text-sm text-on-surface-variant mt-2">
                You can edit the filename. The .jsonc extension will be added automatically if missing.
              </p>
            </div>
            <button
              onClick={handleSaveClick}
              className="bg-tertiary text-on-tertiary font-bold px-6 py-3 rounded-lg hover:bg-tertiary/90 transition-all text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isLoading || !adminPassword || !saveFilename.trim()}
            >
              {saveFileMutation.isPending ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-bold font-headline text-on-surface mb-4">
            Available Scores Files in Bank
          </h2>
          {isLoadingFiles ? (
            <p className="text-on-surface-variant">Loading available files...</p>
          ) : bankFilesData?.files && bankFilesData.files.length > 0 ? (
            <ul className="space-y-2">
              {bankFilesData.files.map((filename) => (
                <li key={filename} className="bg-surface-container hover:bg-surface-container-high border-b border-outline-variant/10 rounded-lg p-4">
                  <div className="flex justify-between items-center mb-2">
                    {renameTargetFile === filename ? (
                      <div className="flex items-center gap-2 flex-grow mr-4">
                        <input
                          type="text"
                          value={newFilename}
                          onChange={(e) => setNewFilename(e.target.value)}
                          className="bg-surface-container-low border border-outline-variant/30 text-on-surface focus:border-primary/50 focus:outline-none rounded px-2 py-1 text-sm flex-grow"
                          autoFocus
                        />
                        <button
                          onClick={submitRename}
                          className="bg-primary text-on-primary font-bold py-1 px-3 rounded transition-all text-sm"
                          disabled={renameFileMutation.isPending}
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setRenameTargetFile(null)}
                          className="bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-on-surface py-1 px-3 rounded text-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <span className="font-mono text-sm text-on-surface-variant">{filename}</span>
                    )}

                    <div className="flex items-center gap-2">
                      {renameTargetFile !== filename && (
                        <>
                          <button
                            onClick={() => handlePreviewClick(filename)}
                            className="bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-on-surface py-1 px-3 rounded text-sm transition-colors disabled:opacity-50"
                            disabled={isLoadingFiles || isLoadingPreview || !adminPassword}
                          >
                            {previewingFile === filename && isLoadingPreview
                              ? "Loading Preview..."
                              : previewingFile === filename
                                ? "Hide Preview"
                                : "Preview"}
                          </button>
                          <button
                            onClick={() => handleLoadClick(filename)}
                            className="bg-primary text-on-primary font-bold py-1 px-3 rounded transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={isLoading || !adminPassword}
                          >
                            {loadFileMutation.isPending &&
                              loadFileMutation.variables === filename
                              ? "Loading..."
                              : "Load"}
                          </button>
                          <button
                            onClick={() => navigate("/admin/scores-bank-review", { state: { adminPassword, filename } })}
                            className="bg-secondary/10 border border-secondary/30 text-secondary hover:bg-secondary/20 font-bold py-1 px-3 rounded transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={!adminPassword}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleRenameClick(filename)}
                            className="bg-surface-container-high border border-primary/30 text-primary hover:bg-primary/10 font-bold py-1 px-3 rounded transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={isLoading || !adminPassword}
                          >
                            Rename
                          </button>
                          <a
                            href={getScoresDownloadUrl(filename, adminPassword || "")}
                            className="bg-tertiary/10 border border-tertiary/30 text-tertiary hover:bg-tertiary/20 py-1 px-3 rounded text-sm transition-all inline-block"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Download
                          </a>
                          {/* Delete Button with Inline Confirmation */}
                          {deleteConfirmFile === filename ? (
                            <div className="flex gap-2 items-center bg-error/10 px-2 py-1 rounded border border-error/30 text-sm">
                              <span className="text-error font-semibold">Delete?</span>
                              <button
                                onClick={() => deleteFileMutation.mutate(filename)}
                                className="bg-error/20 border border-error/50 text-error px-2 py-0.5 text-xs rounded hover:bg-error/30 disabled:opacity-50"
                                disabled={deleteFileMutation.isPending}
                              >
                                {deleteFileMutation.isPending ? "Deleting..." : "Yes"}
                              </button>
                              <button
                                onClick={() => setDeleteConfirmFile(null)}
                                className="bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-on-surface px-2 py-0.5 text-xs rounded disabled:opacity-50"
                                disabled={deleteFileMutation.isPending}
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirmFile(filename)}
                              className="bg-error/10 border border-error/30 text-error hover:bg-error/20 py-1 px-3 rounded text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                      <div className="bg-surface-container-low border border-outline-variant/20 rounded-lg p-4 mt-2">
                        <h3 className="font-semibold text-on-surface text-base mb-4">Preview: {filename}</h3>
                        {/* Rendering scores in a formatted table */}
                        {previewData.length > 0 ? (
                          <div className="space-y-6">
                            {previewData.map((entry, idx) => (
                              <div key={idx} className="bg-surface-container p-4 rounded-lg border border-outline-variant/20">
                                {/* Student Header */}
                                <div className="border-b border-outline-variant/20 pb-3 mb-4">
                                  <h4 className="text-on-surface text-base font-semibold mb-1">
                                    Student: {entry.student}
                                  </h4>
                                  <p className="text-sm text-on-surface-variant">
                                    Quiz ID: {entry.quiz_id}
                                    {entry.quiz_title && <span className="ml-2">({entry.quiz_title})</span>}
                                  </p>
                                  <p className="text-sm text-primary font-medium">
                                    Score: {entry.raw_points} / {entry.max_points} ({entry.percent}%)
                                  </p>
                                  <p className="text-xs text-on-surface-variant/60">
                                    Submitted: {new Date(entry.timestamp + 'Z').toLocaleString()}
                                  </p>
                                </div>

                                {/* Answers List */}
                                <div className="space-y-3">
                                  {entry.answers.map((ans, ansIdx) => (
                                    <div key={ansIdx} className="bg-surface-container-low p-3 rounded border border-outline-variant/20">
                                      {/* Question */}
                                      <div className="font-semibold text-on-surface mb-2">
                                        <span className="mr-2">{ansIdx + 1}.</span>
                                        <ReactMarkdown
                                          remarkPlugins={[remarkGfm]}
                                          rehypePlugins={[rehypeSanitize]}
                                          className="inline"
                                        >
                                          {ans.question_text || ""}
                                        </ReactMarkdown>
                                        <span className="text-xs text-on-surface-variant/50 ml-2">
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
                                        <span className="font-medium text-on-surface-variant">Answer:</span>
                                        <span className="font-mono bg-surface-container-high text-primary px-2 py-1 rounded text-xs">
                                          {JSON.stringify(ans.student_answer)}
                                        </span>
                                        {ans.points_awarded === ans.weight && (
                                          <span className="text-tertiary font-bold text-lg">✓</span>
                                        )}
                                        {ans.points_awarded > 0 && ans.points_awarded < ans.weight && (
                                          <span className="text-secondary font-bold text-lg">⚠</span>
                                        )}
                                        {ans.points_awarded === 0 && (
                                          <span className="text-error font-bold text-lg">❌</span>
                                        )}
                                      </div>

                                      {/* Correct Answer */}
                                      <div className="ml-4 mb-2 text-sm flex items-start gap-2">
                                        <span className="font-medium text-tertiary">Correct:</span>
                                        <span className="font-mono bg-surface-container-low text-tertiary px-2 py-1 rounded text-xs border border-tertiary/20">
                                          {JSON.stringify(ans.correct_answer)}
                                        </span>
                                      </div>

                                      {/* Points */}
                                      <div className="ml-4 text-sm text-on-surface-variant">
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
                          <p className="text-on-surface-variant">No score entries found in this file.</p>
                        )}
                      </div>
                    )}
                  {/* Show preview loading/error states */}
                  {previewingFile === filename && isLoadingPreview && (
                    <p className="text-on-surface-variant mt-2">Loading preview...</p>
                  )}
                  {previewingFile === filename &&
                    previewError &&
                    !isLoadingPreview && (
                      <div className="text-error mt-2">
                        Error loading preview: {previewError.message}
                      </div>
                    )}
                </li>
              ))}
            </ul>
          ) : (
            !isLoadingFiles &&
            !currentError && (
              <p className="text-on-surface-variant">
                No scores files found in the '{SCORES_BANK_FOLDER}' directory.
              </p>
            )
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

export default AdminScoresBankPage;
