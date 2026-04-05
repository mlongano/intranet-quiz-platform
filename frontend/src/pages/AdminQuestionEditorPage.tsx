// frontend/src/pages/AdminQuestionEditorPage.tsx (React Query Version)

import React, { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { parse, ParseError } from "jsonc-parser";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchAdminQuestions, updateAdminQuestions, fetchBankQuizData, updateBankQuiz, QuizData, Question, clearActiveQuizImages, listQuizImages } from "../api";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import QuestionDisplay from "../components/QuestionDisplay";
import { ImagePicker } from "../components/ImagePicker";
import AdminLayout from "../layouts/AdminLayout";
const JsonSafeField = React.lazy(() => import("../components/JsonSafeField"));

const QuestionEditor: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const adminPassword = location.state?.adminPassword;
  const bankFile = searchParams.get("bankFile");
  const [questionsJson, setQuestionsJson] = useState<string>("");
  const [lengthOfQuestions, setLengthOfQuestions] = useState<number>(0);
  const [commonWeight, setCommonWeight] = useState<string>("1");
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [showImagePicker, setShowImagePicker] = useState<boolean>(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
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

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);

        return successful;
      }
    } catch (error) {
      console.error('Copy failed:', error);
      return false;
    }
  }, []);

  const queryClient = useQueryClient();

  const queryKey = bankFile
    ? ["bankQuizData", bankFile, adminPassword]
    : ["adminQuestions", adminPassword];

  const {
    data: questionsData,
    isLoading: isLoadingQuestions,
    isError: isLoadError,
    error: loadError,
    refetch: refetchQuestions,
    isFetching: isFetchingQuestions,
  } = useQuery<QuizData, Error>({
    queryKey: queryKey,
    queryFn: () => {
      if (!adminPassword) {
        return Promise.reject(new Error("Password not available"));
      }
      if (bankFile) {
        return fetchBankQuizData(bankFile, adminPassword);
      }
      return fetchAdminQuestions(adminPassword);
    },
    enabled: !!adminPassword,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const imageQuizFilename = bankFile || "questions.jsonc";
  const { data: imagesData } = useQuery({
    queryKey: ["quizImages", imageQuizFilename, adminPassword],
    queryFn: () => {
      if (!adminPassword) {
        return Promise.reject(new Error("Password not available"));
      }
      return listQuizImages(imageQuizFilename, adminPassword);
    },
    enabled: !!adminPassword,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const imageCount = imagesData?.length || 0;

  useEffect(() => {
    if (questionsData) {
      setQuestionsJson(JSON.stringify(questionsData, null, 2));

      if (questionsData.warning) {
        showToast("warning", questionsData.warning, 0);
      } else {
        showToast("success", "Questions loaded successfully", 2000);
      }

      setLengthOfQuestions(questionsData.questions?.length || 0);
    } else if (!isLoadingQuestions && adminPassword) {
      setQuestionsJson(JSON.stringify({ title: "", questions: [] }, null, 2));
    }
  }, [questionsData, isLoadingQuestions, adminPassword, showToast]);

  const quizTitle = useMemo(() => {
    try {
      const parsed = JSON.parse(questionsJson || '{}');
      return parsed?.title || '';
    } catch {
      return '';
    }
  }, [questionsJson]);

  const {
    mutate: saveQuestionsMutation,
    isPending: isSaving,
    isError: isSaveError,
    error: saveError,
  } = useMutation<
    { success: boolean; message: string },
    Error,
    QuizData
  >({
    mutationFn: (updatedQuizData: QuizData) => {
      if (!adminPassword) {
        return Promise.reject(new Error("Password not available for saving"));
      }
      if (bankFile) {
        return updateBankQuiz(bankFile, updatedQuizData, adminPassword);
      }
      return updateAdminQuestions(updatedQuizData, adminPassword);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKey });
      if (bankFile) {
        queryClient.invalidateQueries({ queryKey: ["questionBankFiles"] });
        queryClient.invalidateQueries({ queryKey: ["quizBankFilePreview", bankFile] });
      }
      showToast("success", data.message || "Questions saved successfully!", 2000);
    },
    onError: (err) => {
      showToast("error", `Save failed: ${err.message}`);
    },
  });

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
      queryClient.invalidateQueries({ queryKey: ["quizImages"] });
    },
    onError: (err) => {
      setShowClearConfirm(false);
      showToast("error", `Failed to clear images: ${err.message}`, 3000);
    },
  });

  const handleSaveChanges = useCallback(() => {
    if (!questionsJson.trim()) {
      showToast("error", "Cannot save empty content.");
      return;
    }

    let parsedData: QuizData;
    try {
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

      if (!parsedData || typeof parsedData !== 'object') {
        throw new Error("Invalid format: Must be an object with 'title' and 'questions' fields.");
      }

      if (Array.isArray(parsedData)) {
        throw new Error("Invalid format: Old array format is no longer supported. Please use: {\"title\": \"Quiz Title\", \"questions\": [...]}");
      }

      if (!parsedData.questions || !Array.isArray(parsedData.questions)) {
        throw new Error("Invalid format: Missing 'questions' array field.");
      }
    } catch (parseError: any) {
      showToast("error", `Invalid JSON format: ${parseError.message}`);
      return;
    }

    setLengthOfQuestions(parsedData.questions.length);
    saveQuestionsMutation(parsedData);
  }, [questionsJson, saveQuestionsMutation, showToast]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        console.log("Save shortcut pressed!");
        handleSaveChanges();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleSaveChanges]);

  const handleSetAllWeights = () => {
    const weightValue = parseFloat(commonWeight);
    if (isNaN(weightValue) || weightValue < 0) {
      showToast("error", "Please enter a valid non-negative number for the weight.");
      return;
    }

    try {
      const currentData: QuizData = JSON.parse(questionsJson || '{"questions":[]}');

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

      let questions: FullQuestion[];
      if (Array.isArray(parsed)) {
        return {
          error: "Cannot preview: Old array format is no longer supported. Please use: {\"title\": \"Quiz Title\", \"questions\": [...]}",
          qs: null
        };
      } else if (parsed && typeof parsed === 'object' && 'questions' in parsed && Array.isArray(parsed.questions)) {
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

  const isProcessing = isLoadingQuestions || isSaving || isFetchingQuestions;

  if (adminPassword === null && !toast) {
    return <div className="flex items-center justify-center min-h-screen bg-surface text-on-surface">Loading editor...</div>;
  }

  if (toast?.type === "error" && adminPassword === null) {
    return <div className="flex items-center justify-center min-h-screen bg-surface text-error font-bold p-4">{toast.text}</div>;
  }

  if (isLoadingQuestions && !questionsData) {
    return <div className="flex items-center justify-center min-h-screen bg-surface text-on-surface">Loading questions...</div>;
  }

  const headerActions = (
    <>
      {quizTitle && (
        <span className="text-on-surface-variant font-body text-sm font-medium">{quizTitle}</span>
      )}
      {imageCount > 0 && (
        <span className="px-3 py-1 rounded-full bg-secondary/15 border border-secondary/30 text-secondary text-xs font-body font-semibold">
          📷 {imageCount}
        </span>
      )}
    </>
  );

  return (
    <AdminLayout
      activePath="/admin/questions"
      adminPassword={adminPassword}
      pageTitle={bankFile ? "Question Editor (Bank)" : "Question Editor"}
      headerActions={headerActions}
    >
      <div className="space-y-4">
      {bankFile && (
          <div className="bg-primary/10 border-l-4 border-primary text-primary p-3 mb-4 flex items-center justify-between rounded-lg">
            <span className="font-body">
              <strong>Editing Bank File:</strong> <span className="font-mono text-sm">{bankFile}</span>
            </span>
            <button
              onClick={() => navigate("/admin/questions-bank", { state: { adminPassword } })}
              className="px-3 py-1 bg-primary/20 hover:bg-primary/30 text-primary text-sm font-body font-semibold rounded transition-colors"
            >
              Back to Bank Manager
            </button>
          </div>
        )}

  
        <div className="sticky top-16 z-20 -mx-8 px-8 py-3 mb-4 bg-surface/90 backdrop-blur-sm border-b border-outline-variant/15 flex flex-wrap gap-4 items-center">
          <button
            onClick={() => refetchQuestions()}
            disabled={isProcessing || !adminPassword}
            className="bg-surface-container-high border border-primary/30 text-primary hover:bg-primary/10 font-body font-bold py-2 px-4 rounded-lg transition-colors disabled:opacity-40"
          >
            {isFetchingQuestions ? "Refreshing..." : "Refresh Questions"}
          </button>
          <button
            title="⌘s or <ctrl-s> to save"
            onClick={handleSaveChanges}
            disabled={isProcessing || !adminPassword}
            className="bg-primary text-on-primary font-body font-bold py-2 px-4 rounded-lg shadow-[0_0_15px_rgba(129,236,255,0.3)] hover:shadow-[0_0_20px_rgba(129,236,255,0.5)] transition-all disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
          <button
            onClick={() => setShowPreview((v) => !v)}
            disabled={isLoadingQuestions}
            className="bg-surface-container-high border border-secondary/30 text-secondary hover:bg-secondary/10 font-body font-bold py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
          >
            {showPreview ? "Hide Preview" : "Preview All Questions"}
          </button>
          <button
            onClick={() => setShowImagePicker(true)}
            disabled={!adminPassword || !quizTitle}
            className="bg-surface-container-high border border-secondary/30 text-secondary hover:bg-secondary/10 font-body font-bold py-2 px-4 rounded-lg transition-colors disabled:opacity-40"
            title={!quizTitle ? "Save quiz first to manage images" : "Manage quiz images"}
          >
            📷 Manage Images
          </button>
          {!bankFile && (
            !showClearConfirm ? (
              <button
                onClick={() => setShowClearConfirm(true)}
                disabled={isClearingImages || !adminPassword}
                className="bg-error/20 border border-error/30 text-error hover:bg-error/30 font-body font-bold py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
                title="Clear all images from active quiz folder"
              >
                🗑️ Clear Images
              </button>
            ) : (
              <div className="flex gap-2 items-center bg-error/10 px-3 py-2 rounded-lg border border-error/30">
                <div className="flex flex-col gap-1">
                  <span className="text-error text-sm font-body font-semibold">Clear all active quiz images?</span>
                  <span className="text-error/70 text-xs font-body">
                    Deletes all images in questions_images/. Bank quiz images are NOT affected.
                  </span>
                </div>
                <button
                  onClick={() => {
                    clearImagesMutation();
                    setShowClearConfirm(false);
                  }}
                  disabled={isClearingImages}
                  className="bg-error/30 hover:bg-error/40 text-error font-body font-bold py-1 px-3 rounded text-sm disabled:opacity-50 whitespace-nowrap transition-colors"
                >
                  {isClearingImages ? "Clearing..." : "Yes, Clear"}
                </button>
                <button
                  onClick={() => setShowClearConfirm(false)}
                  disabled={isClearingImages}
                  className="bg-surface-container-high hover:bg-surface-bright text-on-surface-variant font-body font-bold py-1 px-3 rounded text-sm disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )
          )}
          <div className="flex items-center gap-4">
            <p className="text-on-surface-variant font-body text-sm">Total Questions: <span className="font-semibold text-on-surface">{lengthOfQuestions}</span></p>
            {imageCount > 0 && (
              <p className="text-on-surface-variant font-body text-sm">
                📷 Images: <span className="font-semibold text-on-surface">{imageCount}</span>
              </p>
            )}
          </div>
        </div>

  
        {isLoadError && (
          <div className="bg-error/10 border border-error/20 text-error px-4 py-3 rounded-lg mb-4" role="alert">
            Load failed: {loadError?.message || "Unknown error"}
          </div>
        )}
        {isSaveError && !isSaving && (
          <div className="bg-error/10 border border-error/20 text-error px-4 py-3 rounded-lg mb-4" role="alert">
            Save failed: {saveError?.message || "Unknown error"}
          </div>
        )}

  
        <div className="mb-4 p-4 rounded-lg bg-surface-container-low border border-outline-variant/20">
          <h3 className="text-lg font-body font-semibold mb-2 text-on-surface">Batch Operations</h3>
          <div className="flex items-center gap-2">
            <label htmlFor="commonWeight" className="text-sm font-body font-medium text-on-surface-variant">
              Set all weights to:
            </label>
            <input
              type="number"
              id="commonWeight"
              value={commonWeight}
              onChange={(e) => setCommonWeight(e.target.value)}
              min="1"
              step="1"
              className="bg-surface-container-low border border-outline-variant/30 text-on-surface focus:border-primary/50 focus:outline-none rounded-lg p-1 w-24 text-sm font-body"
              disabled={isProcessing}
            />
            <button
              onClick={handleSetAllWeights}
              disabled={isProcessing || !adminPassword}
              className="bg-surface-container-high border border-secondary/30 text-secondary hover:bg-secondary/10 font-body font-bold py-1 px-3 rounded text-sm disabled:opacity-50 transition-colors"
            >
              Apply Weights
            </button>
          </div>
        </div>

  
        <textarea
          value={questionsJson}
          onChange={(e) => setQuestionsJson(e.target.value)}
          disabled={isProcessing || !adminPassword || isLoadingQuestions}
          placeholder={
            isLoadingQuestions
              ? "Loading questions..."
              : isLoadError
                ? "Error loading questions. Check console."
                : "Edit questions JSON here..."
          }
          rows={25}
          className="w-full p-3 rounded-lg font-mono text-sm bg-surface-container-low border border-outline-variant/30 text-on-surface focus:border-primary/50 focus:outline-none disabled:opacity-50"
          spellCheck="false"
        />

  
        <div className="mt-4">
          <Suspense fallback={<div className="p-4 bg-surface-container-high rounded-lg text-on-surface-variant font-body">Loading helper...</div>}>
            <JsonSafeField />
          </Suspense>
        </div>

  
        {showPreview && (
          <div className="mt-6 p-4 rounded-lg bg-surface-container-low border border-outline-variant/20">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xl font-body font-semibold text-on-surface">Preview (answers highlighted)</h3>
              <span className="text-sm text-on-surface-variant font-body">Green = correct answer</span>
            </div>
            {previewParsed.error ? (
              <div className="bg-orange-500/10 border border-orange-500/20 text-orange-400 px-3 py-2 rounded mb-3 font-body">
                {previewParsed.error}
              </div>
            ) : null}
            {(() => {
              const qs = previewParsed.qs;
              if (!qs) return null;
              if (qs.length === 0)
                return <div className="text-on-surface-variant font-body">No questions to preview.</div>;
              return (
                <div className="space-y-6">
                  {qs.map((q, idx) => (
                    <div key={q.id ?? idx} className="p-4 rounded-lg bg-surface-container border border-outline-variant/20">
                      <div className="mb-2 text-sm text-on-surface-variant font-body">ID: {String(q.id)}</div>
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

  
        {isProcessing && <div className="mt-2 text-primary font-body">Processing...</div>}

  
        {showImagePicker && adminPassword && questionsData && (
          <ImagePicker
            quizFilename={imageQuizFilename}
            password={adminPassword}
            onSelect={async (imagePath) => {
              const success = await copyToClipboard(imagePath);
              if (success) {
                setCopiedPath(imagePath);
                setTimeout(() => setCopiedPath(null), 3000);
              } else {
                showToast("error", `Could not copy to clipboard. Path: ${imagePath}`, 5000);
              }
            }}
            onClose={() => {
              setShowImagePicker(false);
              queryClient.invalidateQueries({ queryKey: ["quizImages"] });
            }}
          />
        )}

  
        {copiedPath && (
          <div className="fixed bottom-5 right-5 bg-tertiary/15 border border-tertiary/30 text-tertiary px-6 py-4 rounded-xl shadow-[0_0_20px_rgba(194,255,153,0.15)] z-[2000] max-w-[500px]">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span className="text-xl">✓</span>
                <strong className="font-body">Image path copied!</strong>
              </div>
              <div className="text-sm font-body break-all bg-black/20 p-2 rounded">
                {copiedPath}
              </div>
              <div className="text-xs opacity-90 font-body">
                Paste this path in the JSON editor for "question_image" or option "image" fields
              </div>
            </div>
          </div>
        )}

  
        {toast && (
          <div
            className={`fixed bottom-5 right-5 z-[2000] max-w-[500px] px-6 py-4 rounded-xl shadow-[0_0_20px_rgba(0,0,0,0.3)] transition-all ${
              toast.type === 'success'
                ? 'bg-tertiary/15 border border-tertiary/30 text-tertiary shadow-[0_0_20px_rgba(194,255,153,0.15)]'
                : toast.type === 'error'
                  ? 'bg-error/15 border border-error/30 text-error shadow-[0_0_20px_rgba(239,68,68,0.15)]'
                  : 'bg-orange-500/15 border border-orange-500/30 text-orange-400 shadow-[0_0_20px_rgba(251,146,60,0.15)]'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-xl flex-shrink-0">
                {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : '⚠'}
              </span>
              <span className="break-word flex-1 font-body">{toast.text}</span>
              <button
                onClick={() => setToast(null)}
                className="bg-none border-none cursor-pointer text-xl p-0 leading-1 opacity-80 hover:opacity-100 flex-shrink-0 transition-opacity"
                title="Close"
              >
                ×
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
};

export default QuestionEditor;
