// frontend/src/pages/AdminScoresBankReviewPage.tsx
import { useState, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  fetchScoresBankFiles,
  fetchPreviewScoresBankFile,
  fetchAdminQuestions,
  ScoresBankFilesResponse,
  ScoreEntry,
  QuizData,
} from "../api";
import SubmissionDetailView from "../components/SubmissionDetailView";

function AdminScoresBankReviewPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const adminPassword = location.state?.adminPassword;
  
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [viewBy, setViewBy] = useState<"student" | "question">("student");
  const [selectedStudentSubmission, setSelectedStudentSubmission] = useState<ScoreEntry | null>(null);
  
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
    
    setError(null);
    setMessage(`Loaded scores from ${filename}`);
  };

  const handleBack = () => {
    setSelectedFilename(null);
    setSelectedStudentSubmission(null);
    
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
        {selectedFilename && (
          <button
            onClick={handleBack}
            className="px-4 py-2 bg-gray-600 text-white rounded-md"
          >
            ← Back to Files
          </button>
        )}
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
            // By Question View
            <div className="space-y-4">
              {questionSummary.map(({ question, answers, correctCount, avgPoints }) => (
                <div key={String(question.id)} className="border p-4 rounded-md">
                  <div className="font-medium mb-2">
                    Q{question.id}: {question.text.substring(0, 50)}{question.text.length > 50 ? "..." : ""}
                  </div>
                  <div className="text-sm text-gray-600 mb-3">
                    Avg Points: {avgPoints} / {question.weight} | Correct: {correctCount}/{answers.length}
                  </div>
                  <div className="text-xs text-gray-500 mb-3">
                    Type: {question.type} | Weight: {question.weight}
                  </div>
                  
                  {/* Show student answers */}
                  <div className="border-t pt-3 mt-3">
                    <div className="text-sm font-medium mb-2">Student Answers:</div>
                    <div className="space-y-1">
                      {answers.slice(0, 5).map(({ student, answer }) => (
                        <div key={student} className="text-xs flex justify-between">
                          <span className="truncate">{student}</span>
                          <span className={`ml-2 ${
                            (answer?.points_awarded || 0) === (answer?.weight || question.weight)
                              ? "text-green-600"
                              : (answer?.points_awarded || 0) > 0
                              ? "text-yellow-600"
                              : "text-red-600"
                          }`}>
                            {(answer?.points_awarded || 0).toString()}/{(answer?.weight || question.weight).toString()}
                          </span>
                        </div>
                      ))}
                      {answers.length > 5 && (
                        <div className="text-xs text-gray-500">
                          ... and {answers.length - 5} more
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {selectedStudentSubmission && (
            <div className="mt-6 border-t pt-6">
              <h3 className="text-lg font-semibold mb-4">Student Detail: {selectedStudentSubmission.student}</h3>
              <SubmissionDetailView
                studentSubmission={selectedStudentSubmission}
                adminPassword={adminPassword}
                onClose={() => setSelectedStudentSubmission(null)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AdminScoresBankReviewPage;
