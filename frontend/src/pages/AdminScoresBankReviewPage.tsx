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
} from "../api";
import SubmissionDetailView from "../components/SubmissionDetailView";

function AdminScoresBankReviewPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const adminPassword = location.state?.adminPassword;
  
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
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
      <div className="container mx-auto p-4">
        <div className="text-red-500">Admin password not provided. Please log in again.</div>
        <button
          onClick={() => navigate("/admin")}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md"
        >
          Go to Login
        </button>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Scores Bank Review</h1>
        <div className="flex gap-2">
          {selectedFilename && (
            <button
              onClick={handleBack}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
            >
              ← Back to Files
            </button>
          )}
          <button
            onClick={() => navigate("/admin/dashboard", { state: { adminPassword } })}
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </div>

      {error && <div className="text-red-500 mb-4">{error}</div>}
      {message && <div className="text-green-500 mb-4">{message}</div>}

      {!selectedFilename ? (
        // File selection view
        <div>
          <p className="text-sm text-gray-600 mb-4">
            Select a scores file to review:
          </p>
          
          {isLoadingFiles ? (
            <div>Loading scores bank files...</div>
          ) : filesError ? (
            <div className="text-red-500">Error loading files: {filesError.message}</div>
          ) : (
            <div className="space-y-2">
              {bankFilesData?.files?.length ? (
                bankFilesData.files.map((filename) => (
                  <div
                    key={filename}
                    className="border p-3 rounded-md hover:bg-gray-50 cursor-pointer"
                    onClick={() => handleSelectFile(filename)}
                  >
                    <div className="font-medium">{filename}</div>
                  </div>
                ))
              ) : (
                <p className="text-gray-500">No scores files found in the bank.</p>
              )}
            </div>
          )}
        </div>
      ) : (
        // Scores review view
        <div>
          <div className="mb-4">
            <h2 className="text-xl font-semibold mb-2">
              Reviewing: {selectedFilename}
            </h2>
            
            {/* Statistics */}
            {stats && (
              <div className="grid grid-cols-3 gap-4 mb-4 p-4 bg-gray-50 rounded-md">
                <div className="text-center">
                  <div className="text-2xl font-bold">{stats.totalStudents}</div>
                  <div className="text-sm text-gray-600">Total Students</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{stats.completedStudents}</div>
                  <div className="text-sm text-gray-600">Completed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{stats.avgScore}%</div>
                  <div className="text-sm text-gray-600">Avg Score</div>
                </div>
              </div>
            )}

            {/* View toggle */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setViewBy("student")}
                className={`px-4 py-2 rounded-md ${
                  viewBy === "student"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-300 text-gray-700"
                }`}
              >
                By Student
              </button>
              <button
                onClick={() => setViewBy("question")}
                className={`px-4 py-2 rounded-md ${
                  viewBy === "question"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-300 text-gray-700"
                }`}
              >
                By Question
              </button>
            </div>
          </div>

          {isLoadingScores ? (
            <div>Loading scores...</div>
          ) : viewBy === "student" ? (
            // By Student View
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {scoresData?.map((submission) => (
                <div
                  key={`${submission.student}-${submission.quiz_id}`}
                  className="border p-4 rounded-md hover:shadow-lg cursor-pointer"
                  onClick={() => setSelectedStudentSubmission(submission)}
                >
                  <div className="font-medium mb-2">{submission.student}</div>
                  <div className="text-sm text-gray-600">
                    Score: {submission.raw_points}/{submission.max_points} ({submission.percent}%)
                  </div>
                  <div className="text-xs text-gray-500">
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
                  <div key={String(question.id)} className="border rounded-md overflow-hidden">
                    <div 
                      className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => {
                        setExpandedQuestionId(isExpanded ? null : question.id);
                        setQuestionOverrides({});
                      }}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="font-medium mb-1">
                            Q{question.id}: {question.text}
                          </div>
                          <div className="text-sm text-gray-600">
                            Avg: {avgPoints}/{question.weight} | Correct: {correctCount}/{answers.length} | Type: {question.type}
                          </div>
                        </div>
                        <span className="text-gray-400 text-xl ml-4">
                          {isExpanded ? "▼" : "▶"}
                        </span>
                      </div>
                    </div>
                    
                    {isExpanded && (
                      <div className="border-t bg-gray-50 p-4">
                        <div className="text-sm font-medium mb-3">
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
                                className="bg-white border rounded-md p-3 shadow-sm"
                              >
                                <div className="flex flex-col md:flex-row md:items-center gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium text-sm truncate">{student}</div>
                                    <div className="text-xs text-gray-500 mt-1">
                                      <span className="font-medium">Answer: </span>
                                      <span className="font-mono bg-gray-100 px-1 rounded">
                                        {JSON.stringify(answer?.student_answer ?? "N/A")}
                                      </span>
                                    </div>
                                    <div className="text-xs text-green-700 mt-1">
                                      <span className="font-medium">Correct: </span>
                                      <span className="font-mono bg-green-50 px-1 rounded">
                                        {JSON.stringify(answer?.correct_answer ?? "N/A")}
                                      </span>
                                    </div>
                                    {question.type === 'open' && (answer?.llm_verdict || answer?.llm_feedback) && (
                                      <div className="mt-2 p-2 bg-purple-50 rounded border border-purple-100 text-xs">
                                        <div className="font-semibold text-purple-800 mb-1">
                                          🤖 LLM Evaluation
                                        </div>
                                        {answer.llm_verdict && (
                                          <div className="mb-1">
                                            <span className="font-medium">Verdict:</span>{" "}
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${
                                              answer.llm_verdict.toLowerCase() === 'correct' ? 'bg-green-100 text-green-700' :
                                              answer.llm_verdict.toLowerCase() === 'incorrect' ? 'bg-red-100 text-red-700' :
                                              'bg-yellow-100 text-yellow-700'
                                            }`}>
                                              {answer.llm_verdict}
                                            </span>
                                          </div>
                                        )}
                                        {answer.llm_feedback && (
                                          <div>
                                            <span className="font-medium">Feedback:</span>{" "}
                                            <span className="text-gray-700 italic">{answer.llm_feedback}</span>
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
                                        className="w-16 border rounded px-2 py-1 text-sm text-center"
                                      />
                                      <span className="text-sm text-gray-500">/ {maxPoints}</span>
                                    </div>
                                    
                                    <button
                                      onClick={() => handleSaveQuestionOverride(student, question.id, quizId)}
                                      disabled={!hasOverride || isSaving}
                                      className={`px-3 py-1 text-sm rounded transition-colors ${
                                        hasOverride && !isSaving
                                          ? "bg-blue-600 text-white hover:bg-blue-700"
                                          : "bg-gray-200 text-gray-400 cursor-not-allowed"
                                      }`}
                                    >
                                      {isSaving ? "..." : "Save"}
                                    </button>
                                    
                                    <span className={`text-lg ${
                                      currentPoints === maxPoints
                                        ? "text-green-600"
                                        : currentPoints > 0
                                        ? "text-yellow-500"
                                        : "text-red-500"
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
            <div className="mt-6 border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">Student Detail: {selectedStudentSubmission.student}</h3>
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
  );
}

export default AdminScoresBankReviewPage;
