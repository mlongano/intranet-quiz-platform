// frontend/src/pages/AdminScoresBankReviewPage.tsx
import { useState, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  fetchScoresBankFiles,
  fetchPreviewScoresBankFile,
  fetchAdminQuestions,
  ScoresBankFilesResponse,
  ScoreEntry,
  QuizData,
  saveBankScoreOverrides,
  BankOverridePayload,
  regradeOpenScoresBank,
  RegradeOpenBankResponse,
  fetchLlmInfo,
  LlmInfoResponse,
} from "../api";
import SubmissionDetailView from "../components/SubmissionDetailView";
import AdminLayout from "../layouts/AdminLayout";

function AdminScoresBankReviewPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const adminPassword = location.state?.adminPassword;

  const [selectedFilename, setSelectedFilename] = useState<string | null>(location.state?.filename ?? null);
  const [viewBy, setViewBy] = useState<"student" | "question">("student");
  const [selectedStudentSubmission, setSelectedStudentSubmission] = useState<ScoreEntry | null>(null);
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | number | null>(null);
  const [questionOverrides, setQuestionOverrides] = useState<Record<string, number>>({});
  const [savingStudent, setSavingStudent] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Fetch list of scores bank files
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
      setError(null);
      setMessage(null);
      return fetchScoresBankFiles(adminPassword);
    },
    enabled: !!adminPassword,
  });

  // Fetch current quiz questions for question-based view
  const { data: questionsData } = useQuery<QuizData, Error>({
    queryKey: ["adminQuestions", adminPassword],
    queryFn: () => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      return fetchAdminQuestions(adminPassword);
    },
    enabled: !!adminPassword,
  });

  const { data: llmInfo } = useQuery<LlmInfoResponse, Error>({
    queryKey: ["llmInfo", adminPassword],
    queryFn: () => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      return fetchLlmInfo(adminPassword);
    },
    enabled: !!adminPassword,
  });

  // Fetch selected scores file
  const {
    data: scoresData,
    isLoading: isLoadingScores,
  } = useQuery<ScoreEntry[], Error>({
    queryKey: ["scoresBankPreview", selectedFilename, adminPassword],
    queryFn: () => {
      if (!adminPassword || !selectedFilename) {
        throw new Error("Admin password or filename not available.");
      }
      return fetchPreviewScoresBankFile(selectedFilename, adminPassword);
    },
    enabled: !!adminPassword && !!selectedFilename,
  });

  // Calculate statistics
  const stats = useMemo(() => {
    if (!scoresData) return null;

    const totalStudents = scoresData.length;
    const completedStudents = scoresData.filter(s => s.percent > 0).length;
    const avgScore = totalStudents > 0
      ? scoresData.reduce((sum, s) => sum + s.percent, 0) / totalStudents
      : 0;

    return {
      totalStudents,
      completedStudents,
      avgScore: avgScore.toFixed(1),
    };
  }, [scoresData]);

  // Calculate question summary for question view
  const questionSummary = useMemo(() => {
    if (!scoresData || !questionsData) return [];

    return questionsData.questions.map((question) => {
      const questionAnswers = scoresData.map((student) => {
        const answer = student.answers.find((a) => String(a.question_id) === String(question.id));
        return {
          student: student.student,
          answer,
        };
      });

      const correctCount = questionAnswers.filter((q) => q.answer && q.answer.points_awarded === q.answer.weight).length;
      const avgPoints = questionAnswers.reduce((sum, q) => sum + (q.answer?.points_awarded || 0), 0) / scoresData.length;

      return {
        question,
        answers: questionAnswers,
        correctCount,
        avgPoints: avgPoints.toFixed(2),
      };
    });
  }, [scoresData, questionsData]);

  const handleSelectFile = (filename: string) => {
    setSelectedFilename(filename);
    setSelectedStudentSubmission(null);
    setExpandedQuestionId(null);
    setError(null);
    setMessage(`Loaded scores from ${filename}`);
  };

  const handleBack = () => {
    setSelectedFilename(null);
    setSelectedStudentSubmission(null);
    setExpandedQuestionId(null);
  };

  const handleSubmissionUpdated = (updatedSubmission: ScoreEntry) => {
    queryClient.invalidateQueries({ queryKey: ["scoresBankPreview", selectedFilename, adminPassword] });
    setSelectedStudentSubmission(updatedSubmission);
  };

  const saveQuestionOverrideMutation = useMutation({
    mutationFn: saveBankScoreOverrides,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scoresBankPreview", selectedFilename, adminPassword] });
      setMessage("Score updated successfully!");
      setSavingStudent(null);
    },
    onError: (err: any) => {
      setError(`Failed to save: ${err.message}`);
      setSavingStudent(null);
    },
  });

  const regradeOpenMutation = useMutation<RegradeOpenBankResponse, Error, { filename: string; useLLM?: boolean }>({
    mutationFn: ({ filename, useLLM }) => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      setError(null);
      setMessage(null);
      return regradeOpenScoresBank(filename, adminPassword, useLLM);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["scoresBankPreview", selectedFilename, adminPassword] });
      setMessage(`Regraded open questions. Updated ${data.updated_answers} answers in ${data.updated_submissions} submissions.`);
    },
    onError: (err: any) => {
      setError(`Failed to regrade open questions: ${err.message}`);
    },
  });

  const handleQuestionOverrideChange = (studentEmail: string, newPoints: string, maxPoints: number) => {
    const key = studentEmail;
    const points = newPoints === "" ? undefined : parseFloat(newPoints);

    setQuestionOverrides(prev => {
      const updated = { ...prev };
      if (points === undefined || isNaN(points)) {
        delete updated[key];
      } else {
        updated[key] = Math.max(0, Math.min(points, maxPoints));
      }
      return updated;
    });
  };

  const handleSaveQuestionOverride = (studentEmail: string, questionId: string | number, quizId: string) => {
    if (!selectedFilename || !adminPassword) return;

    const newPoints = questionOverrides[studentEmail];
    if (newPoints === undefined) return;

    setSavingStudent(studentEmail);
    setError(null);
    setMessage(null);

    const payload: BankOverridePayload = {
      filename: selectedFilename,
      student_id: studentEmail,
      quiz_id: quizId,
      overrides: [{ question_id: questionId, points: newPoints }],
      password: adminPassword,
    };

    saveQuestionOverrideMutation.mutate(payload);
    setQuestionOverrides(prev => {
      const updated = { ...prev };
      delete updated[studentEmail];
      return updated;
    });
  };

  if (!adminPassword) {
    return (
      <div className="flex min-h-screen bg-[#0a0e14] text-[#f1f3fc] items-center justify-center">
        <div className="text-red-400 mb-4">Admin password not provided. Please log in again.</div>
        <button
          onClick={() => navigate("/admin")}
          className="px-4 py-2 bg-[#81ecff] text-[#005762] font-bold rounded-md"
        >
          Go to Login
        </button>
      </div>
    );
  }

  return (
    <AdminLayout
      activePath="/admin/scores"
      adminPassword={adminPassword}
      pageTitle="Review Scores"
    >
      <div>
        {error && <div className="text-red-400 mb-4">{error}</div>}
        {message && <div className="text-[#c2ff99] mb-4">{message}</div>}

        {!selectedFilename ? (
          // File selection view
          <div>
            <p className="text-sm text-[#a8abb3] mb-4">
              Select a scores file to review:
            </p>

            {isLoadingFiles ? (
              <div className="text-[#a8abb3]">Loading scores bank files...</div>
            ) : filesError ? (
              <div className="text-red-400">Error loading files: {filesError.message}</div>
            ) : (
              <div className="space-y-2">
                {bankFilesData?.files?.length ? (
                  bankFilesData.files.map((filename) => (
                    <div
                      key={filename}
                      className="bg-[#151a21] border border-[#44484f]/20 rounded-lg p-4 hover:border-[#81ecff]/30 cursor-pointer transition-colors"
                      onClick={() => handleSelectFile(filename)}
                    >
                      <div className="font-medium text-[#f1f3fc]">{filename}</div>
                    </div>
                  ))
                ) : (
                  <p className="text-[#a8abb3]">No scores files found in the bank.</p>
                )}
              </div>
            )}
          </div>
        ) : (
          // Scores review view
          <div>
            <div className="mb-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-[#f1f3fc]">
                  Reviewing: {selectedFilename}
                </h2>
                <button
                  onClick={handleBack}
                  className="px-4 py-2 bg-[#1b2028] border border-[#44484f]/30 text-[#a8abb3] hover:text-[#f1f3fc] hover:border-[#81ecff]/30 rounded-md transition-colors text-sm"
                >
                  ← Back to Files
                </button>
              </div>

              {/* Statistics */}
              {stats && (
                <div className="grid grid-cols-3 gap-4 mb-4 p-4 bg-[#0f141a] border border-[#44484f]/20 rounded-xl">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-[#f1f3fc]">{stats.totalStudents}</div>
                    <div className="text-sm text-[#a8abb3]">Total Students</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-[#f1f3fc]">{stats.completedStudents}</div>
                    <div className="text-sm text-[#a8abb3]">Completed</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-[#81ecff]">{stats.avgScore}%</div>
                    <div className="text-sm text-[#a8abb3]">Avg Score</div>
                  </div>
                </div>
              )}

              {/* View toggle */}
              <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[#a8abb3]">
                    LLM regrade:
                  </span>
                  <span className="bg-[#e966ff]/10 border border-[#e966ff]/30 text-[#e966ff] text-xs px-2 py-0.5 rounded">
                    {llmInfo ? llmInfo.model : "Unknown"}
                  </span>
                  {llmInfo && (
                    <span className="text-xs text-[#a8abb3]">
                      ({llmInfo.enabled ? "enabled" : "disabled"})
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => selectedFilename && regradeOpenMutation.mutate({ filename: selectedFilename })}
                    disabled={regradeOpenMutation.isPending}
                    className={`px-4 py-2 rounded-md text-sm font-bold transition-colors ${
                      regradeOpenMutation.isPending
                        ? "bg-[#1b2028] text-[#a8abb3] cursor-not-allowed"
                        : "bg-[#1b2028] border border-[#e966ff]/30 text-[#e966ff] hover:bg-[#e966ff]/10"
                    }`}
                  >
                    {regradeOpenMutation.isPending ? "Regrading..." : "Regrade Open Questions"}
                  </button>
                  <div className="flex gap-1 bg-[#0f141a] border border-[#44484f]/20 rounded-lg p-1">
                    <button
                      onClick={() => setViewBy("student")}
                      className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                        viewBy === "student"
                          ? "bg-[#262c36] text-[#81ecff]"
                          : "text-[#a8abb3] hover:text-[#f1f3fc]"
                      }`}
                    >
                      By Student
                    </button>
                    <button
                      onClick={() => setViewBy("question")}
                      className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                        viewBy === "question"
                          ? "bg-[#262c36] text-[#81ecff]"
                          : "text-[#a8abb3] hover:text-[#f1f3fc]"
                      }`}
                    >
                      By Question
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {isLoadingScores ? (
              <div className="text-[#a8abb3]">Loading scores...</div>
            ) : viewBy === "student" ? (
              // By Student View
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {scoresData?.map((submission) => (
                  <div
                    key={`${submission.student}-${submission.quiz_id}`}
                    className="bg-[#151a21] border border-[#44484f]/20 rounded-xl p-4 hover:border-[#81ecff]/30 cursor-pointer transition-colors"
                    onClick={() => setSelectedStudentSubmission(submission)}
                  >
                    <div className="font-medium mb-2 text-[#f1f3fc]">{submission.student}</div>
                    <div className="text-sm text-[#a8abb3]">
                      Score: {submission.raw_points}/{submission.max_points} ({submission.percent}%)
                    </div>
                    <div className="text-xs text-[#a8abb3]/70 mt-1">
                      {new Date(submission.timestamp).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              // By Question View - click question to expand and edit scores inline
              <div className="space-y-4">
                {questionSummary.map(({ question, answers, correctCount, avgPoints }) => {
                  const isExpanded = expandedQuestionId === question.id;

                  return (
                    <div key={String(question.id)} className="bg-[#151a21] border border-[#44484f]/20 rounded-xl overflow-hidden">
                      <div
                        className="p-4 cursor-pointer hover:bg-[#1b2028] transition-colors"
                        onClick={() => {
                          setExpandedQuestionId(isExpanded ? null : question.id);
                          setQuestionOverrides({});
                        }}
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="font-medium mb-1 text-[#f1f3fc]">
                              Q{question.id}: {question.text}
                            </div>
                            <div className="text-sm text-[#a8abb3]">
                              Avg: {avgPoints}/{question.weight} | Correct: {correctCount}/{answers.length} | Type: {question.type}
                            </div>
                          </div>
                          <span className="text-[#a8abb3] text-xl ml-4">
                            {isExpanded ? "▼" : "▶"}
                          </span>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-[#44484f]/20 bg-[#0f141a] p-4">
                          <div className="text-sm font-medium mb-3 text-[#f1f3fc]">
                            Edit scores for this question ({answers.length} students):
                          </div>
                          <div className="space-y-3 max-h-96 overflow-y-auto">
                            {answers.map(({ student, answer }) => {
                              const submission = scoresData?.find(s => s.student === student);
                              const quizId = submission?.quiz_id || "";
                              const currentPoints = answer?.points_awarded || 0;
                              const maxPoints = answer?.weight || question.weight;
                              const hasOverride = questionOverrides[student] !== undefined;
                              const displayPoints = hasOverride ? questionOverrides[student] : currentPoints;
                              const isSaving = savingStudent === student;

                              return (
                                <div
                                  key={student}
                                  className="bg-[#151a21] border border-[#44484f]/20 rounded-lg p-3"
                                >
                                  <div className="flex flex-col md:flex-row md:items-center gap-3">
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-sm text-[#f1f3fc] truncate">{student}</div>
                                      <div className="text-xs text-[#a8abb3] mt-1">
                                        <span className="font-medium">Answer: </span>
                                        <span className="font-mono bg-[#0f141a] px-1 rounded">
                                          {JSON.stringify(answer?.student_answer ?? "N/A")}
                                        </span>
                                      </div>
                                      <div className={`text-xs mt-1 p-2 rounded border ${
                                        answer?.points_awarded === answer?.weight
                                          ? "bg-[#c2ff99]/10 border-[#c2ff99]/30 text-[#c2ff99]"
                                          : "bg-red-500/10 border-red-500/30 text-red-400"
                                      }`}>
                                        <span className="font-medium">Correct: </span>
                                        <span className="font-mono">
                                          {JSON.stringify(answer?.correct_answer ?? "N/A")}
                                        </span>
                                      </div>
                                      {question.type === 'open' && (answer?.llm_verdict || answer?.llm_feedback) && (
                                        <div className="mt-2 p-2 bg-[#e966ff]/5 rounded border border-[#e966ff]/20 text-xs">
                                          <div className="font-semibold text-[#e966ff] mb-1">
                                            LLM Evaluation
                                          </div>
                                          {answer.llm_verdict && (
                                            <div className="mb-1">
                                              <span className="font-medium">Verdict:</span>{" "}
                                              <span className="bg-[#e966ff]/10 border border-[#e966ff]/30 text-[#e966ff] text-xs px-2 py-0.5 rounded uppercase font-bold tracking-wider">
                                                {answer.llm_verdict}
                                              </span>
                                            </div>
                                          )}
                                          {answer.llm_feedback && (
                                            <div>
                                              <span className="font-medium">Feedback:</span>{" "}
                                              <span className="text-[#a8abb3] italic">{answer.llm_feedback}</span>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-2">
                                      <div className="flex items-center gap-1">
                                        <input
                                          type="number"
                                          min="0"
                                          max={maxPoints}
                                          step="0.5"
                                          value={displayPoints}
                                          onChange={(e) => handleQuestionOverrideChange(student, e.target.value, maxPoints)}
                                          className="bg-[#0f141a] border border-[#44484f]/30 text-[#f1f3fc] focus:border-[#81ecff]/50 focus:outline-none rounded w-16 text-center text-sm"
                                        />
                                        <span className="text-sm text-[#a8abb3]">/ {maxPoints}</span>
                                      </div>

                                      <button
                                        onClick={() => handleSaveQuestionOverride(student, question.id, quizId)}
                                        disabled={!hasOverride || isSaving}
                                        className={`px-3 py-1 text-sm rounded transition-colors ${
                                          hasOverride && !isSaving
                                            ? "bg-[#81ecff] text-[#005762] font-bold"
                                            : "bg-[#1b2028] text-[#a8abb3] cursor-not-allowed"
                                        }`}
                                      >
                                        {isSaving ? "..." : "Save"}
                                      </button>

                                      <span className={`text-lg ${
                                        currentPoints === maxPoints
                                          ? "text-[#c2ff99]"
                                          : currentPoints > 0
                                            ? "text-yellow-400"
                                            : "text-red-400"
                                      }`}>
                                        {currentPoints === maxPoints ? "✓" : currentPoints > 0 ? "⚠" : "✗"}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {selectedStudentSubmission && selectedFilename && (
              <div className="mt-6 border-t border-[#44484f]/20 pt-6">
                <h3 className="text-lg font-semibold mb-4 text-[#f1f3fc]">Student Detail: {selectedStudentSubmission.student}</h3>
                <SubmissionDetailView
                  studentSubmission={selectedStudentSubmission}
                  adminPassword={adminPassword}
                  onClose={() => setSelectedStudentSubmission(null)}
                  bankFilename={selectedFilename}
                  onSubmissionUpdated={handleSubmissionUpdated}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

export default AdminScoresBankReviewPage;
