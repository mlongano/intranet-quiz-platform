import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { fetchScores, fetchStudents, fetchAdminQuestions, fetchQuestionBankFiles, fetchScoresBankFiles, listStudentsBankFiles, getGitSyncStatus, initGitSync, syncBanks } from "../api";

export default function AdminRootPage() {
  const location = useLocation();
  const adminPassword = location.state?.adminPassword;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isValidating, setIsValidating] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(30);
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [showSubmittedModal, setShowSubmittedModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string>("");
  const [syncError, setSyncError] = useState<string>("");

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
  const { data: scoresData, isFetching: isFetchingScores, dataUpdatedAt } = useQuery({
    queryKey: ["scores", adminPassword],
    queryFn: () => fetchScores(adminPassword),
    enabled: !!adminPassword && !isValidating,
    refetchInterval: 30000, // Refetch every 30 seconds
    refetchIntervalInBackground: false, // Don't refetch when tab is not visible
  });

  // Countdown timer for next auto-update
  useEffect(() => {
    setCountdown(30); // Reset countdown when data updates
  }, [dataUpdatedAt]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) return 30;
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

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

  // Git sync status query
  const { data: syncStatus, refetch: refetchSyncStatus, error: syncStatusError, isLoading: syncStatusLoading } = useQuery({
    queryKey: ["gitSyncStatus", adminPassword],
    queryFn: () => getGitSyncStatus(adminPassword),
    enabled: !!adminPassword && !isValidating,
    retry: false,
  });

  // Debug: Log sync status
  useEffect(() => {
    console.log('[Git Sync] Query status:', {
      loading: syncStatusLoading,
      data: syncStatus,
      error: syncStatusError
    });
    if (syncStatus) {
      console.log('[Git Sync] Status received:', syncStatus);
    }
    if (syncStatusError) {
      console.error('[Git Sync] Status Error:', syncStatusError);
    }
  }, [syncStatus, syncStatusError, syncStatusLoading]);

  // Git sync mutations
  const initMutation = useMutation({
    mutationFn: () => initGitSync(adminPassword),
    onSuccess: (data) => {
      setSyncMessage(data.message);
      setSyncError("");
      setShowSyncModal(true);
      refetchSyncStatus();
    },
    onError: (error: any) => {
      setSyncError(error.message || "Failed to initialize Git sync");
      setSyncMessage("");
      setShowSyncModal(true);
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => syncBanks(adminPassword, true),
    onSuccess: (data) => {
      setSyncMessage(data.message);
      setSyncError("");
      setShowSyncModal(true);
      refetchSyncStatus();
      // Refetch bank data after sync
      queryClient.invalidateQueries({ queryKey: ["questionBankFiles"] });
      queryClient.invalidateQueries({ queryKey: ["scoresBankFiles"] });
      queryClient.invalidateQueries({ queryKey: ["studentsBankFiles"] });
    },
    onError: (error: any) => {
      setSyncError(error.message || "Failed to sync banks");
      setSyncMessage("");
      setShowSyncModal(true);
    },
  });

  const handleGitSync = () => {
    if (!syncStatus?.configured) {
      setSyncError("Cloud sync not configured. Please set BANKS_GIT_REMOTE, BANKS_GIT_USERNAME, and BANKS_GIT_TOKEN in your .env file.");
      setShowSyncModal(true);
      return;
    }

    if (!syncStatus?.initialized) {
      initMutation.mutate();
    } else {
      syncMutation.mutate();
    }
  };

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

  const handleRefreshScores = () => {
    queryClient.invalidateQueries({ queryKey: ["scores", adminPassword] });
    setCountdown(30); // Reset countdown on manual refresh
  };

  // Calculate statistics
  const totalSubmissions = scoresData?.length || 0;

  // Get all student emails from the studentsData
  const allStudentEmails = studentsData ?
    studentsData.reduce<string[]>((emails, student) => {
      if (typeof student === 'string') {
        emails.push(student.toLowerCase());
      } else if ('emails' in student) {
        emails.push(...student.emails.map(e => e.toLowerCase()));
      } else if ('email' in student) {
        emails.push(student.email.toLowerCase());
      }
      return emails;
    }, []) : [];

  const totalStudents = allStudentEmails.length;

  // Get submitted student IDs
  const submittedStudentIds = new Set(
    scoresData?.map(score => score.student.toLowerCase()) || []
  );

  // Calculate pending submissions
  const pendingSubmissions = allStudentEmails.filter(
    email => !submittedStudentIds.has(email)
  ).length;

  // Get list of pending students
  const pendingStudentEmails = allStudentEmails.filter(
    email => !submittedStudentIds.has(email)
  );

  // Get list of submitted students
  const submittedStudentEmails = allStudentEmails.filter(
    email => submittedStudentIds.has(email)
  );

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
            <div className="flex gap-3">
              <button
                onClick={() => navigate("/")}
                className="px-4 py-2 bg-white text-teal-700 font-medium rounded-lg hover:bg-teal-50 transition-colors"
              >
                View Quiz
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <button
            onClick={() => navigateTo("/admin/questions")}
            className="bg-white rounded-lg shadow-md p-6 border-l-4 border-blue-500 hover:shadow-lg transition-shadow text-left flex items-start justify-between cursor-pointer"
          >
            <div>
              <p className="text-blue-600 text-base font-bold">Current Quiz</p>
              <p className="text-2xl font-bold text-gray-800 mt-1">{quizTitle}</p>
              <p className="text-gray-600 text-sm mt-2">{totalQuestions} questions</p>
            </div>
            <div className="text-blue-500 text-4xl">📝</div>
          </button>

          <button
            onClick={() => navigateTo("/admin/scores")}
            className="bg-white rounded-lg shadow-md p-6 border-l-4 border-green-500 hover:shadow-lg transition-shadow text-left flex items-start justify-between mb-2 cursor-pointer"
          >
            <div className="flex-1">
              <p className="text-green-600 text-base font-bold">Submissions</p>
              <p className="text-2xl font-bold text-gray-800 mt-1">{totalSubmissions}</p>
              <p className="text-gray-400 text-sm animate-pulse">
                {isFetchingScores && ("Updating...")} &nbsp;
              </p>

              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSubmittedModal(true);
                  }}
                  className="text-gray-600 text-sm hover:text-gray-800 hover:underline cursor-pointer"
                >
                  {totalSubmissions} submitted
                </button>
                {pendingSubmissions > 0 && (
                  <>
                    <span className="text-gray-400">•</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowPendingModal(true);
                      }}
                      className="text-orange-600 text-sm font-medium hover:text-orange-700 hover:underline cursor-pointer"
                    >
                      {pendingSubmissions} pending
                    </button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <p className="text-gray-400 text-xs">
                  Auto-updates in {countdown}s
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRefreshScores();
                  }}
                  disabled={isFetchingScores}
                  className="text-gray-400 hover:text-gray-600 text-xs hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Refresh now"
                >
                  🔄 Refresh now
                </button>
              </div>
            </div>
            <div className="text-green-500 text-4xl">✅</div>
          </button>

          <button
            onClick={() => navigateTo("/admin/students")}
            className="bg-white rounded-lg shadow-md p-6 border-l-4 border-purple-500 hover:shadow-lg transition-shadow text-left flex items-start justify-between cursor-pointer"
          >
            <div>
              <p className="text-purple-600 text-base font-bold">Students</p>
              <p className="text-2xl font-bold text-gray-800 mt-1">{totalStudents}</p>
              <p className="text-gray-600 text-sm mt-2">Enrolled students</p>
            </div>
            <div className="text-purple-500 text-4xl">👥</div>
          </button>

          <button
            onClick={() => navigateTo("/admin/bank")}
            className="bg-white rounded-lg shadow-md p-6 border-l-4 border-orange-500 hover:shadow-lg transition-shadow text-left flex flex-col cursor-pointer"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-orange-600 text-base font-bold">Archives</p>
                <p className="text-2xl font-bold text-gray-800 mt-1">
                  {(questionBankFiles?.files?.length || 0) + (scoresBankFiles?.files?.length || 0) + (studentsBankFiles?.files?.length || 0)}
                </p>
                <div className="text-gray-600 text-xs mt-2 space-y-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateTo("/admin/bank");
                    }}
                    className="block hover:text-blue-600 hover:underline cursor-pointer"
                  >
                    {questionBankFiles?.files?.length || 0} questions
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateTo("/admin/scores-bank");
                    }}
                    className="block hover:text-green-600 hover:underline cursor-pointer"
                  >
                    {scoresBankFiles?.files?.length || 0} scores
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateTo("/admin/students-bank");
                    }}
                    className="block hover:text-purple-600 hover:underline cursor-pointer"
                  >
                    {studentsBankFiles?.files?.length || 0} students
                  </button>
                </div>
              </div>
              <div className="text-orange-500 text-4xl">🗄️</div>
            </div>

            {/* Sync Button */}
            {syncStatus?.configured && (
              <div className="border-t border-orange-200 pt-3 mt-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleGitSync();
                  }}
                  disabled={initMutation.isPending || syncMutation.isPending}
                  className="w-full px-3 py-2 bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-medium rounded-lg hover:from-teal-700 hover:to-cyan-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  title={syncStatus.initialized ? 'Sync banks to cloud' : 'Initialize cloud sync'}
                >
                  {(initMutation.isPending || syncMutation.isPending) ? (
                    <>
                      <span className="inline-block animate-spin">⟳</span>
                      Syncing...
                    </>
                  ) : (
                    <>
                      ☁️ {syncStatus.initialized ? 'Sync to Cloud' : 'Initialize Sync'}
                    </>
                  )}
                </button>
                {syncStatus.initialized && syncStatus.last_commit && (
                  <p className="text-xs text-gray-500 mt-2 text-center">
                    Last: {syncStatus.last_commit}
                  </p>
                )}
              </div>
            )}
          </button>
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

      {/* Pending Students Modal */}
      {showPendingModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="bg-orange-500 text-white px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold">Pending Submissions ({pendingSubmissions})</h2>
              <button
                onClick={() => setShowPendingModal(false)}
                className="text-white hover:text-orange-100 text-2xl font-bold"
              >
                ×
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              {pendingStudentEmails.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-gray-600 text-sm mb-4">
                    The following students have not submitted their quiz yet:
                  </p>
                  <ul className="space-y-1">
                    {pendingStudentEmails.map((email, index) => (
                      <li
                        key={index}
                        className="px-4 py-2 bg-orange-50 border border-orange-200 rounded text-gray-800 hover:bg-orange-100 transition-colors"
                      >
                        {email}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-gray-600 text-center py-8">
                  All students have submitted their quiz! 🎉
                </p>
              )}
            </div>
            <div className="bg-gray-50 px-6 py-4 flex justify-end border-t">
              <button
                onClick={() => setShowPendingModal(false)}
                className="px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submitted Students Modal */}
      {showSubmittedModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="bg-green-500 text-white px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold">Submitted Students ({totalSubmissions})</h2>
              <button
                onClick={() => setShowSubmittedModal(false)}
                className="text-white hover:text-green-100 text-2xl font-bold"
              >
                ×
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              {submittedStudentEmails.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-gray-600 text-sm mb-4">
                    The following students have successfully submitted their quiz:
                  </p>
                  <ul className="space-y-1">
                    {submittedStudentEmails.map((email, index) => (
                      <li
                        key={index}
                        className="px-4 py-2 bg-green-50 border border-green-200 rounded text-gray-800 hover:bg-green-100 transition-colors"
                      >
                        {email}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-gray-600 text-center py-8">
                  No submissions yet.
                </p>
              )}
            </div>
            <div className="bg-gray-50 px-6 py-4 flex justify-end border-t">
              <button
                onClick={() => setShowSubmittedModal(false)}
                className="px-6 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Git Sync Modal */}
      {showSyncModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full overflow-hidden flex flex-col">
            <div className={`${syncError ? 'bg-red-500' : 'bg-teal-500'} text-white px-6 py-4 flex justify-between items-center`}>
              <h2 className="text-xl font-bold">
                {syncError ? '❌ Sync Failed' : '✅ Sync Complete'}
              </h2>
              <button
                onClick={() => setShowSyncModal(false)}
                className="text-white hover:text-gray-100 text-2xl font-bold"
              >
                ×
              </button>
            </div>
            <div className="p-6">
              {syncError ? (
                <div className="text-red-700 bg-red-50 p-4 rounded-lg border border-red-200">
                  <p className="font-semibold mb-2">Error:</p>
                  <p className="whitespace-pre-wrap">{syncError}</p>
                </div>
              ) : (
                <div className="text-teal-700 bg-teal-50 p-4 rounded-lg border border-teal-200">
                  <p className="whitespace-pre-wrap">{syncMessage}</p>
                </div>
              )}
              {syncStatus && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200 text-sm">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Status:</span>
                      <span className="font-medium">
                        {syncStatus.initialized ? '✓ Initialized' : '○ Not initialized'}
                      </span>
                    </div>
                    {syncStatus.last_commit && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Last commit:</span>
                        <span className="font-medium text-xs">{syncStatus.last_commit}</span>
                      </div>
                    )}
                    {syncStatus.remote_url && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Remote:</span>
                        <span className="font-medium text-xs">{syncStatus.remote_url}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="bg-gray-50 px-6 py-4 flex justify-end border-t">
              <button
                onClick={() => setShowSyncModal(false)}
                className={`px-6 py-2 ${syncError ? 'bg-red-500 hover:bg-red-600' : 'bg-teal-500 hover:bg-teal-600'} text-white rounded-lg transition-colors font-medium`}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
