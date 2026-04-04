// frontend/src/pages/AdminBankManagerPage.tsx
import { useState, useMemo, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import {
  fetchQuestionBankFiles,
  loadQuizFromBank,
  saveQuizToBank,
  deleteQuizFromBank,
  fetchPreviewBankFile,
  BankOperationResponse,
  QuestionBankFilesResponse,
  Question,
  fetchAdminQuestions,
  QuizData,
  getQuizDownloadUrl,
  renameQuizInBank,
} from "../api";
import { slugify } from "../lib/utils";
import AdminLayout from "../layouts/AdminLayout";

function AdminBankManagerPage() {
  const location = useLocation();
  const navigate = useNavigate();

  const adminPassword = location.state?.adminPassword;

  const [saveFilename, setSaveFilename] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [previewingFile, setPreviewingFile] = useState<string | null>(null);
  const [justLoadedFile, setJustLoadedFile] = useState(false);
  const [deleteConfirmFile, setDeleteConfirmFile] = useState<string | null>(null);
  const [renameTargetFile, setRenameTargetFile] = useState<string | null>(null);
  const [newFilename, setNewFilename] = useState("");

  const queryClient = useQueryClient();

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
    retry: false,
  });

  useEffect(() => {
    if (questionsError && justLoadedFile) {
      console.log("Questions query error suppressed after file load:", questionsError.message);
      const timer = setTimeout(() => setJustLoadedFile(false), 2000);
      return () => clearTimeout(timer);
    } else if (!questionsError && justLoadedFile) {
      setJustLoadedFile(false);
    }
  }, [questionsError, justLoadedFile]);

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
      return `${datePrefix}_${slug}.jsonc`;
    }
    return `${datePrefix}_quiz.jsonc`;
  }, [currentQuizData?.title]);

  useMemo(() => {
    if (defaultFilename) {
      setSaveFilename(defaultFilename);
    }
  }, [defaultFilename]);

  const {
    data: bankFilesData,
    isLoading: isLoadingFiles,
    error: filesError,
    refetch: refetchFiles,
  } = useQuery<QuestionBankFilesResponse, Error>({
    queryKey: ["questionBankFiles", adminPassword],
    queryFn: () => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      return fetchQuestionBankFiles(adminPassword);
    },
    enabled: !!adminPassword,
  });

  const loadFileMutation = useMutation<BankOperationResponse, Error, string>({
    mutationFn: (filename: string) => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      setError(null);
      setWarning(null);
      setMessage(null);
      console.log("Loading quiz from bank:", filename);
      return loadQuizFromBank(filename, adminPassword);
    },
    retry: false,
    onSuccess: (data) => {
      console.log("Load success, response:", data);
      setJustLoadedFile(true);
      if (data.warning) {
        console.log("Setting warning:", data.warning);
        setWarning(data.warning);
      }
      setMessage(data.message || "File loaded successfully!");
      queryClient.invalidateQueries({ queryKey: ["adminQuestions"] });
    },
    onError: (err: any) => {
      console.error("Load error:", err);
      setError(`Failed to load file: ${err.message}`);
    },
    onSettled: () => {
      refetchFiles();
    },
  });

  const saveFileMutation = useMutation<BankOperationResponse, Error, string>({
    mutationFn: (filename_suffix: string) => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      setError(null);
      setWarning(null);
      setMessage(null);
      return saveQuizToBank(filename_suffix, adminPassword);
    },
    onSuccess: (data) => {
      setMessage(data.message || "File saved successfully!");
      setSaveFilename("");
      queryClient.invalidateQueries({ queryKey: ["questionBankFiles"] });
    },
    onError: (err: any) => {
      setError(`Failed to save file: ${err.message}`);
    },
  });

  const deleteFileMutation = useMutation<BankOperationResponse, Error, string>({
    mutationFn: (filename: string) => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      setError(null);
      setWarning(null);
      setMessage(null);
      return deleteQuizFromBank(filename, adminPassword);
    },
    onSuccess: (data, filename) => {
      setDeleteConfirmFile(null);
      setMessage(data.message || `File '${filename}' deleted successfully!`);
      queryClient.invalidateQueries({ queryKey: ["questionBankFiles"] });
    },
    onError: (err: any) => {
      setDeleteConfirmFile(null);
      setError(`Failed to delete file: ${err.message}`);
    },
  });

  const renameFileMutation = useMutation<BankOperationResponse, Error, { filename: string; newFilename: string }>({
    mutationFn: ({ filename, newFilename }) => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      setError(null);
      setWarning(null);
      setMessage(null);
      return renameQuizInBank(filename, newFilename, adminPassword);
    },
    onSuccess: (data, variables) => {
      setRenameTargetFile(null);
      setNewFilename("");
      setMessage(data.message || `File '${variables.filename}' renamed successfully!`);
      queryClient.invalidateQueries({ queryKey: ["questionBankFiles"] });
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

  const {
    data: previewData,
    isLoading: isLoadingPreview,
    error: previewError,
  } = useQuery<Question[], Error>({
    queryKey: ["quizBankFilePreview", previewingFile, adminPassword],
    queryFn: () => {
      if (!previewingFile || !adminPassword) {
        throw new Error("Preview file or password not available.");
      }
      return fetchPreviewBankFile(previewingFile, adminPassword);
    },
    enabled: !!previewingFile && !!adminPassword,
    staleTime: Infinity,
  });

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
      setWarning(null);
      setMessage(null);
    } else {
      setPreviewingFile(filename);
      setError(null);
      setWarning(null);
      setMessage(null);
    }
  };

  const handleDeleteClick = (filename: string) => {
    setDeleteConfirmFile(filename);
  };

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
    questionsError ||
    loadFileMutation.error ||
    saveFileMutation.error ||
    deleteFileMutation.error ||
    renameFileMutation.error ||
    previewError;

  return (
    <AdminLayout
      activePath="/admin/questions-bank"
      adminPassword={adminPassword || ""}
      pageTitle="Question Banks"
    >
      <div className="max-w-5xl">
        {!adminPassword && (
          <div className="bg-error/10 border border-error/30 rounded-lg px-4 py-3 mb-6 text-sm text-error">
            Admin password not provided via navigation state. Please log in via the admin login page.
          </div>
        )}

        {currentError && (
          <div className="bg-error/10 border border-error/30 rounded-lg px-4 py-3 mb-6 text-sm text-error">
            Error: {typeof currentError === "string" ? currentError : currentError.message || "An unknown error occurred."}
          </div>
        )}

        {questionsError && !currentError && !justLoadedFile && (
          <div className="bg-error/10 border border-error/30 rounded-lg px-4 py-3 mb-6 text-sm text-error">
            Error loading current quiz: {(questionsError as Error).message || 'Unknown error'}
          </div>
        )}

        {warning && (
          <div className="bg-secondary/10 border border-secondary/20 rounded-lg px-4 py-3 mb-6">
            <p className="font-bold text-secondary text-sm">Warning</p>
            <p className="text-secondary/80 text-sm mt-1">{warning}</p>
          </div>
        )}

        {message && (
          <div className="bg-tertiary/10 border border-tertiary/30 rounded-lg px-4 py-3 mb-6 text-sm text-tertiary">
            {message}
          </div>
        )}

        <div className="mb-8">
          <h2 className="font-headline text-lg font-bold text-on-surface mb-3">
            Save Current Quiz to Bank
          </h2>
          {currentQuizData?.title && (
            <p className="text-sm text-on-surface-variant mb-3">
              Quiz title: <span className="text-on-surface font-medium">"{currentQuizData.title}"</span>
            </p>
          )}
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Enter filename (e.g., 20251025_123456_quiz-title.jsonc)"
              className="bg-surface-container-low border border-outline-variant/30 text-on-surface focus:border-primary/50 focus:outline-none rounded px-3 py-2 flex-grow font-mono text-sm placeholder:text-outline-variant"
              value={saveFilename}
              onChange={(e) => setSaveFilename(e.target.value)}
              disabled={isLoading || !adminPassword}
            />
            <button
              onClick={handleSaveClick}
              className="bg-primary text-on-primary font-bold py-2 px-5 rounded transition-all text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isLoading || !adminPassword || !saveFilename.trim()}
            >
              {saveFileMutation.isPending ? "Saving..." : "Save"}
            </button>
          </div>
          <p className="text-xs text-on-surface-variant mt-2">
            You can edit the filename. The .jsonc extension will be added automatically if missing.
          </p>
        </div>

        <div>
          <h2 className="font-headline text-lg font-bold text-on-surface mb-3">
            Available Quiz Files in Bank
          </h2>
          {isLoadingFiles ? (
            <p className="text-on-surface-variant text-sm">Loading available files...</p>
          ) : bankFilesData?.files && bankFilesData.files.length > 0 ? (
            <ul className="space-y-1">
              {bankFilesData.files.map((filename) => (
                <li key={filename} className="bg-surface-container hover:bg-surface-container-high border-b border-outline-variant/10 rounded-lg p-4 mb-2 last:mb-0">
                  <div className="flex justify-between items-center mb-2">
                    {renameTargetFile === filename ? (
                      <div className="flex items-center gap-2 flex-grow mr-2">
                        <input
                          type="text"
                          value={newFilename}
                          onChange={(e) => setNewFilename(e.target.value)}
                          className="bg-surface-container-low border border-outline-variant/30 text-on-surface focus:border-primary/50 focus:outline-none rounded px-2 py-1 text-sm flex-grow"
                          autoFocus
                        />
                        <button
                          onClick={submitRename}
                          className="bg-tertiary text-on-tertiary font-bold py-1 px-3 rounded transition-all text-sm"
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
                      <span className="text-on-surface font-body text-sm">{filename}</span>
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
                            onClick={() => navigate(`/admin/questions?bankFile=${encodeURIComponent(filename)}`, { state: { adminPassword } })}
                            className="bg-surface-container-high border border-primary/30 text-primary hover:bg-primary/10 font-bold py-1 px-3 rounded transition-colors text-sm"
                            disabled={!adminPassword}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleLoadClick(filename)}
                            className="bg-primary text-on-primary font-bold py-1 px-3 rounded transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={isLoading || !adminPassword}
                          >
                            {loadFileMutation.isPending && loadFileMutation.variables === filename
                              ? "Loading..."
                              : "Load"}
                          </button>
                          <button
                            onClick={() => handleRenameClick(filename)}
                            className="bg-surface-container-high border border-secondary/30 text-secondary hover:bg-secondary/10 font-bold py-1 px-3 rounded transition-colors text-sm disabled:opacity-50"
                            disabled={isLoading || !adminPassword}
                          >
                            Rename
                          </button>
                          <a
                            href={getQuizDownloadUrl(filename, adminPassword || "")}
                            className="text-on-surface-variant hover:text-primary text-sm transition-colors px-2 py-1"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Download
                          </a>
                          {deleteConfirmFile === filename ? (
                            <div className="flex gap-2 items-center bg-error/10 px-2 py-1 rounded border border-error/30 text-sm">
                              <span className="text-error font-semibold">Delete?</span>
                              <button
                                onClick={() => deleteFileMutation.mutate(filename)}
                                className="bg-error/20 border border-error/50 text-error px-2 py-0.5 rounded text-xs hover:bg-error/30 transition-colors disabled:opacity-50"
                                disabled={deleteFileMutation.isPending}
                              >
                                {deleteFileMutation.isPending ? "Deleting..." : "Yes"}
                              </button>
                              <button
                                onClick={() => setDeleteConfirmFile(null)}
                                className="bg-surface-container-high border border-outline-variant/30 text-on-surface-variant px-2 py-0.5 rounded text-xs hover:text-on-surface transition-colors disabled:opacity-50"
                                disabled={deleteFileMutation.isPending}
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleDeleteClick(filename)}
                              className="bg-error/10 border border-error/30 text-error py-1 px-3 rounded text-sm hover:bg-error/20 transition-colors disabled:opacity-50"
                              disabled={isLoading || !adminPassword}
                            >
                              Delete
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {previewingFile === filename && !isLoadingPreview && previewData && (
                    <div className="bg-surface-container-low border border-outline-variant/20 rounded-lg p-4 mt-2">
                      <h3 className="font-semibold text-on-surface mb-3 text-sm">Preview:</h3>
                      {previewData.length > 0 ? (
                        previewData.map((q, index) => (
                          <div key={q.id || index} className="mb-3 pb-3 border-b border-outline-variant/10 last:border-b-0 last:mb-0 last:pb-0">
                            <p className="text-on-surface-variant text-xs mb-1">
                              <strong className="text-on-surface">ID:</strong> {q.id}
                            </p>
                            <p className="text-on-surface-variant text-xs mb-1">
                              <strong className="text-on-surface">Type:</strong> {q.type}
                            </p>
                            <p className="text-on-surface-variant text-xs mb-1">
                              <strong className="text-on-surface">Weight:</strong> {q.weight}
                            </p>
                            <div className="mt-2">
                              <strong className="text-on-surface text-xs">Text:</strong>
                              <div className="mt-1 text-on-surface">
                                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                                  {q.text || ""}
                                </ReactMarkdown>
                              </div>
                            </div>
                            {q.options && q.options.length > 0 && (
                              <div className="mt-2">
                                <strong className="text-on-surface text-xs">Options:</strong>
                                <ul className="mt-1 space-y-1">
                                  {q.options.map((opt, optIndex) => (
                                    <li key={optIndex} className="ml-4 text-on-surface-variant text-xs">
                                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                                        {typeof opt === "string" ? opt : opt.text || ""}
                                      </ReactMarkdown>
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
                            {"correct" in q && (
                              <p className="text-on-surface-variant text-xs mt-1">
                                <strong className="text-on-surface">Correct:</strong> {JSON.stringify(q.correct)}
                              </p>
                            )}
                            {q.question_image && (
                              <div className="mt-2">
                                <strong className="text-on-surface text-xs">Question Image:</strong>
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
                        <p className="text-on-surface-variant text-sm">No questions found in this file.</p>
                      )}
                    </div>
                  )}
                  {previewingFile === filename && isLoadingPreview && (
                    <p className="text-on-surface-variant text-sm mt-2">Loading preview...</p>
                  )}
                  {previewingFile === filename && previewError && !isLoadingPreview && (
                    <div className="bg-error/10 border border-error/30 rounded-lg px-3 py-2 mt-2 text-sm text-error">
                      Error loading preview: {previewError.message}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            !isLoadingFiles && !currentError && (
              <p className="text-on-surface-variant text-sm">No quiz files found in the questionbank_folder directory.</p>
            )
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

export default AdminBankManagerPage;
