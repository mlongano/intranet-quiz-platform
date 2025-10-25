import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchScores, fetchStudents, fetchAdminQuestions, fetchQuestionBankFiles, fetchScoresBankFiles, listStudentsBankFiles } from "../api";

export default function AdminRootPage() {
  const location = useLocation();
  const adminPassword = location.state?.adminPassword;
  const navigate = useNavigate();
  const [isValidating, setIsValidating] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Validate password on mount
  useEffect(() => {
    const validateAccess = async () => {
      if (!adminPassword) {
        navigate("/admin", { replace: true });
        return;
      }

      try {
        await fetchScores(adminPassword);
        setIsValidating(false);
      } catch {
        setValidationError("Invalid session. Redirecting to login...");
        setTimeout(() => {
          navigate("/admin", { replace: true });
        }, 2000);
      }
    };

    validateAccess();
  }, [adminPassword, navigate]);

  // Fetch dashboard statistics
  const { data: scoresData } = useQuery({
    queryKey: ["scores", adminPassword],
    queryFn: () => fetchScores(adminPassword),
    enabled: !!adminPassword && !isValidating,
  });

  const { data: studentsData } = useQuery({
    queryKey: ["students", adminPassword],
    queryFn: () => fetchStudents(adminPassword),
    enabled: !!adminPassword && !isValidating,
  });

  const { data: questionsData } = useQuery({
    queryKey: ["questions", adminPassword],
    queryFn: () => fetchAdminQuestions(adminPassword),
    enabled: !!adminPassword && !isValidating,
  });

  const { data: questionBankFiles } = useQuery({
    queryKey: ["questionBankFiles", adminPassword],
    queryFn: () => fetchQuestionBankFiles(adminPassword),
    enabled: !!adminPassword && !isValidating,
  });

  const { data: scoresBankFiles } = useQuery({
    queryKey: ["scoresBankFiles", adminPassword],
    queryFn: () => fetchScoresBankFiles(adminPassword),
    enabled: !!adminPassword && !isValidating,
  });

  const { data: studentsBankFiles } = useQuery({
    queryKey: ["studentsBankFiles", adminPassword],
    queryFn: () => listStudentsBankFiles(adminPassword),
    enabled: !!adminPassword && !isValidating,
  });

  // Show loading while validating
  if (isValidating) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-lg">Validating access...</p>
        </div>
      </div>
    );
  }

  // Show error message if validation failed
  if (validationError) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-lg text-red-600">{validationError}</p>
        </div>
      </div>
    );
  }

  const navigateTo = (path: string) => {
    navigate(path, { state: { adminPassword } });
  };

  // Calculate statistics
  const totalSubmissions = scoresData?.length || 0;
  const totalStudents = studentsData ?
    studentsData.reduce((sum, student) => {
      if (typeof student === 'string') return sum + 1;
      if ('emails' in student) return sum + student.emails.length;
      if ('email' in student) return sum + 1;
      return sum;
    }, 0) : 0;
  const totalQuestions = questionsData?.questions?.length || 0;
  const quizTitle = questionsData?.title || "No quiz loaded";

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-gradient-to-r from-teal-600 to-teal-700 text-white shadow-lg">
        <div className="container mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold">QuizParty Admin</h1>
              <p className="text-teal-100 text-sm mt-1">Quiz Management Dashboard</p>
            </div>
            <button
              onClick={() => navigate("/")}
              className="px-4 py-2 bg-white text-teal-700 font-medium rounded-lg hover:bg-teal-50 transition-colors"
            >
              View Quiz
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-blue-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm font-medium">Current Quiz</p>
                <p className="text-2xl font-bold text-gray-800 mt-1">{quizTitle}</p>
                <p className="text-gray-600 text-sm mt-2">{totalQuestions} questions</p>
              </div>
              <div className="text-blue-500 text-4xl">📝</div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-green-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm font-medium">Submissions</p>
                <p className="text-2xl font-bold text-gray-800 mt-1">{totalSubmissions}</p>
                <p className="text-gray-600 text-sm mt-2">Total quiz attempts</p>
              </div>
              <div className="text-green-500 text-4xl">✅</div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-purple-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm font-medium">Students</p>
                <p className="text-2xl font-bold text-gray-800 mt-1">{totalStudents}</p>
                <p className="text-gray-600 text-sm mt-2">Enrolled students</p>
              </div>
              <div className="text-purple-500 text-4xl">👥</div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-orange-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm font-medium">Archives</p>
                <p className="text-2xl font-bold text-gray-800 mt-1">
                  {(questionBankFiles?.files?.length || 0) + (scoresBankFiles?.files?.length || 0) + (studentsBankFiles?.files?.length || 0)}
                </p>
                <p className="text-gray-600 text-sm mt-2">Saved in banks</p>
              </div>
              <div className="text-orange-500 text-4xl">🗄️</div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Quiz Management */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <span className="text-2xl">📚</span>
              Quiz Management
            </h2>
            <div className="space-y-3">
              <button
                onClick={() => navigateTo("/admin/questions")}
                className="w-full text-left px-4 py-3 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors border border-blue-200"
              >
                <div className="font-semibold text-blue-900">Edit Questions</div>
                <div className="text-sm text-blue-700">Modify quiz content and answers</div>
              </button>
              <button
                onClick={() => navigateTo("/admin/bank")}
                className="w-full text-left px-4 py-3 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors border border-blue-200"
              >
                <div className="font-semibold text-blue-900">Question Bank</div>
                <div className="text-sm text-blue-700">Save & load quiz templates</div>
              </button>
            </div>
          </div>

          {/* Results & Scoring */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <span className="text-2xl">📊</span>
              Results & Scoring
            </h2>
            <div className="space-y-3">
              <button
                onClick={() => navigateTo("/admin/scores")}
                className="w-full text-left px-4 py-3 bg-green-50 hover:bg-green-100 rounded-lg transition-colors border border-green-200"
              >
                <div className="font-semibold text-green-900">View Scores</div>
                <div className="text-sm text-green-700">Review submissions & send emails</div>
              </button>
              <button
                onClick={() => navigateTo("/admin/scores-bank")}
                className="w-full text-left px-4 py-3 bg-green-50 hover:bg-green-100 rounded-lg transition-colors border border-green-200"
              >
                <div className="font-semibold text-green-900">Scores Archive</div>
                <div className="text-sm text-green-700">Save & restore score history</div>
              </button>
            </div>
          </div>

          {/* Student Management */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <span className="text-2xl">👨‍🎓</span>
              Student Management
            </h2>
            <div className="space-y-3">
              <button
                onClick={() => navigateTo("/admin/students")}
                className="w-full text-left px-4 py-3 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors border border-purple-200"
              >
                <div className="font-semibold text-purple-900">Manage Students</div>
                <div className="text-sm text-purple-700">Edit student list & groups</div>
              </button>
              <button
                onClick={() => navigateTo("/admin/students-bank")}
                className="w-full text-left px-4 py-3 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors border border-purple-200"
              >
                <div className="font-semibold text-purple-900">Students Archive</div>
                <div className="text-sm text-purple-700">Save & load class lists</div>
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
