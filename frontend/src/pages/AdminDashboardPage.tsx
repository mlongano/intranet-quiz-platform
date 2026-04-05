import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Cloud,
  ExternalLink,
  Github,
  Pencil,
  RefreshCw,
  FileText,
  Trophy,
  Archive,
  BarChart3,
  Users,
} from "lucide-react";
import {
  fetchScores,
  fetchStudents,
  fetchAdminQuestions,
  fetchQuestionBankFiles,
  fetchScoresBankFiles,
  listStudentsBankFiles,
  getGitSyncStatus,
  initGitSync,
  syncBanks,
  getQuizStatus,
  setQuizStatus,
} from "../api";
import AdminLayout from "../layouts/AdminLayout";

// ─── StatCard ─────────────────────────────────────────────────────────────────
const StatCard = ({
  title,
  value,
  middleContent,
  subtext,
  ghostIcon: GhostIcon,
  accentClass,
  onClick,
  delay = 0,
}: {
  title: string;
  value: string | number;
  middleContent?: ReactNode;
  subtext: ReactNode;
  ghostIcon: any;
  accentClass: string;
  onClick?: () => void;
  delay?: number;
}) => (
  <motion.button
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay }}
    onClick={onClick}
    className="relative overflow-hidden flex-1 p-6 rounded-2xl bg-surface-container hover:bg-surface-container-high transition-all hover:scale-[1.02] cursor-pointer text-left flex flex-col group"
  >
    {/* Top accent strip */}
    <div className={`absolute top-0 left-0 w-full h-0.5 ${accentClass}`} />

    {/* Ghost watermark icon */}
    <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
      <GhostIcon size={96} />
    </div>

    <p className="text-xs font-bold uppercase tracking-widest mb-4 font-body text-on-surface-variant">
      {title}
    </p>

    <div className="text-4xl font-bold tracking-tight leading-tight text-on-surface font-headline mb-2">
      {value}
    </div>

    {middleContent && (
      <div className="flex-1 flex items-center">{middleContent}</div>
    )}

    <div className="text-on-surface-variant text-xs mt-auto">{subtext}</div>
  </motion.button>
);

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdminRootPage() {
  const location = useLocation();
  const adminPassword = location.state?.adminPassword;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [countdown, setCountdown] = useState(30);
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [showSubmittedModal, setShowSubmittedModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string>("");
  const [syncError, setSyncError] = useState<string>("");

  // ── Guard: redirect if no password ──────────────────────────────────────
  if (!adminPassword) {
    navigate("/admin", { replace: true });
    return null;
  }

  const navigateTo = (path: string) => {
    navigate(path, { state: { adminPassword } });
  };

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: scoresData, isFetching: isFetchingScores, dataUpdatedAt } = useQuery({
    queryKey: ["scores", adminPassword],
    queryFn: () => fetchScores(adminPassword),
    enabled: !!adminPassword,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => { setCountdown(30); }, [dataUpdatedAt]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? 30 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const { data: studentsData } = useQuery({
    queryKey: ["students", adminPassword],
    queryFn: () => fetchStudents(adminPassword),
    enabled: !!adminPassword,
  });

  const { data: questionsData } = useQuery({
    queryKey: ["questions", adminPassword],
    queryFn: () => fetchAdminQuestions(adminPassword),
    enabled: !!adminPassword,
  });

  const { data: questionBankFiles } = useQuery({
    queryKey: ["questionBankFiles", adminPassword],
    queryFn: () => fetchQuestionBankFiles(adminPassword),
    enabled: !!adminPassword,
  });

  const { data: scoresBankFiles } = useQuery({
    queryKey: ["scoresBankFiles", adminPassword],
    queryFn: () => fetchScoresBankFiles(adminPassword),
    enabled: !!adminPassword,
  });

  const { data: studentsBankFiles } = useQuery({
    queryKey: ["studentsBankFiles", adminPassword],
    queryFn: () => listStudentsBankFiles(adminPassword),
    enabled: !!adminPassword,
  });

  const { data: quizStatus, refetch: refetchQuizStatus } = useQuery({
    queryKey: ["quizStatus"],
    queryFn: () => getQuizStatus(),
    enabled: !!adminPassword,
  });

  const { data: syncStatus, refetch: refetchSyncStatus, error: syncStatusError, isLoading: syncStatusLoading } = useQuery({
    queryKey: ["gitSyncStatus", adminPassword],
    queryFn: () => getGitSyncStatus(adminPassword),
    enabled: !!adminPassword,
    retry: false,
  });

  useEffect(() => {
    console.log("[Git Sync] Query status:", {
      loading: syncStatusLoading,
      data: syncStatus,
      error: syncStatusError,
    });
    if (syncStatus) console.log("[Git Sync] Status received:", syncStatus);
    if (syncStatusError) console.error("[Git Sync] Status Error:", syncStatusError);
  }, [syncStatus, syncStatusError, syncStatusLoading]);

  // ── Mutations ────────────────────────────────────────────────────────────
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

  const toggleQuizStatusMutation = useMutation({
    mutationFn: (enabled: boolean) => setQuizStatus(enabled, adminPassword),
    onSuccess: () => { refetchQuizStatus(); },
    onError: (error: any) => {
      setSyncError(error.message || "Failed to update quiz status");
      setSyncMessage("");
      setShowSyncModal(true);
    },
  });

  const handleGitSync = () => {
    if (!syncStatus?.configured) {
      setSyncError(
        "Cloud sync not configured. Please set BANKS_GIT_REMOTE, BANKS_GIT_USERNAME, and BANKS_GIT_TOKEN in your .env file.",
      );
      setShowSyncModal(true);
      return;
    }
    if (!syncStatus?.initialized) {
      initMutation.mutate();
    } else {
      syncMutation.mutate();
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const handleRefreshScores = () => {
    queryClient.invalidateQueries({ queryKey: ["scores", adminPassword] });
    setCountdown(30);
  };

  const EXCLUDED_GROUP = import.meta.env.VITE_EXCLUDED_GROUP ?? "Theacher";

  const allStudentEmails = studentsData
    ? studentsData.reduce<string[]>((emails, student) => {
        if (typeof student === "string") {
          emails.push(student.toLowerCase());
        } else if ("emails" in student) {
          if (student.group === EXCLUDED_GROUP) return emails;
          emails.push(...student.emails.map((e) => e.toLowerCase()));
        } else if ("email" in student) {
          if ((student as { email: string; group?: string }).group === EXCLUDED_GROUP) return emails;
          emails.push(student.email.toLowerCase());
        }
        return emails;
      }, [])
    : [];

  const groupNames = studentsData
    ? [
        ...new Set(
          studentsData.flatMap((student) => {
            if (typeof student === "string") return [];
            if ("emails" in student) {
              return student.group !== EXCLUDED_GROUP ? [student.group] : [];
            }
            const g = (student as { email: string; group?: string }).group;
            return g && g !== EXCLUDED_GROUP ? [g] : [];
          }),
        ),
      ]
    : [];

  const totalSubmissions = scoresData
    ? scoresData.filter((s) => allStudentEmails.includes(s.student.toLowerCase())).length
    : 0;

  const totalStudents = allStudentEmails.length;

  const submittedStudentIds = new Set(
    scoresData?.map((score) => score.student.toLowerCase()) || [],
  );

  const pendingSubmissions = allStudentEmails.filter(
    (email) => !submittedStudentIds.has(email),
  ).length;

  const pendingStudentEmails = allStudentEmails.filter(
    (email) => !submittedStudentIds.has(email),
  );

  const submittedStudentEmails = allStudentEmails.filter(
    (email) => submittedStudentIds.has(email),
  );

  const totalQuestions = questionsData?.questions?.length || 0;
  const quizTitle = questionsData?.title || "No quiz loaded";

  const percentValues =
    scoresData
      ?.filter((s) => allStudentEmails.includes(s.student.toLowerCase()))
      .map((s) => s.percent) ?? [];
  const meanPercent =
    percentValues.length > 0
      ? Math.round(percentValues.reduce((a, b) => a + b, 0) / percentValues.length)
      : null;
  const medianPercent = (() => {
    if (percentValues.length === 0) return null;
    const sorted = [...percentValues].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];
  })();
  const skewnessPercent = (() => {
    if (percentValues.length === 0 || meanPercent === null) return null;
    const avg = percentValues.reduce((a, b) => a + b, 0) / percentValues.length;
    const variance = percentValues.reduce((acc, x) => acc + Math.pow(x - avg, 2), 0) / percentValues.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return 0;
    const thirdMoment = percentValues.reduce((acc, x) => acc + Math.pow(x - avg, 3), 0) / percentValues.length;
    return Math.round((thirdMoment / Math.pow(stdDev, 3)) * 100) / 100;
  })();

  const totalArchives =
    (questionBankFiles?.files?.length || 0) +
    (scoresBankFiles?.files?.length || 0) +
    (studentsBankFiles?.files?.length || 0);

  // ── Header actions ───────────────────────────────────────────────────────
  const headerActions = (
    <>
      {/* Quiz status toggle */}
      <div className="flex items-center gap-3 px-4 py-2 rounded-full bg-surface-container-high border border-outline-variant/20">
        <button
          onClick={() => toggleQuizStatusMutation.mutate(!quizStatus?.enabled)}
          disabled={toggleQuizStatusMutation.isPending}
          className={`relative inline-flex h-5 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
            quizStatus?.enabled ? "bg-tertiary" : "bg-outline-variant"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-surface transition-transform ${
              quizStatus?.enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
        <span className="text-sm font-medium font-body">
          Quiz:{" "}
          <span
            className={
              quizStatus?.enabled ? "text-tertiary" : "text-on-surface-variant"
            }
          >
            {quizStatus?.enabled ? "Active" : "Inactive"}
          </span>
        </span>
      </div>

      {/* Sync to Cloud */}
      {syncStatus?.configured && (
        <button
          onClick={handleGitSync}
          disabled={initMutation.isPending || syncMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-container-high text-secondary border border-secondary/30 hover:bg-secondary/10 transition-all text-sm font-semibold font-body disabled:opacity-50"
        >
          <Cloud size={16} />
          {initMutation.isPending || syncMutation.isPending
            ? "Syncing..."
            : "Sync to Cloud"}
        </button>
      )}

      {/* GitHub link */}
      {syncStatus?.remote_url && (
        <a
          href={
            syncStatus.remote_url?.replace(/\.git$/, "") ||
            "https://github.com/mlongano/intranet-quiz-manager"
          }
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-container-high text-on-surface text-sm font-semibold font-body hover:bg-surface-bright transition-all"
        >
          <Github size={16} />
          GitHub
        </a>
      )}

      {/* Open Quiz */}
      <a
        href="/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-container-high text-tertiary border border-tertiary/30 hover:bg-tertiary/10 transition-all text-sm font-semibold font-body"
      >
        <ExternalLink size={16} />
        Open Quiz
      </a>

      {/* Create New Quiz */}
      <button
        onClick={() => navigateTo("/admin/questions")}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-on-primary font-bold font-body shadow-[0_0_15px_rgba(129,236,255,0.3)] hover:scale-105 transition-all text-sm"
      >
        <Pencil size={16} />
        Edit Questions
      </button>
    </>
  );

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <AdminLayout
      activePath="/admin/dashboard"
      adminPassword={adminPassword}
      pageTitle="Dashboard"
      headerActions={headerActions}
    >
      <div className="space-y-8">
        {/* Status Bar */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center justify-between bg-surface-container-low p-4 rounded-xl border border-outline-variant/10 shadow-[0_0_20px_rgba(129,236,255,0.08)]"
        >
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1 bg-tertiary/10 rounded-full">
              <span className="w-2 h-2 rounded-full bg-tertiary animate-pulse" />
              <span className="text-tertiary text-sm font-bold font-body">
                Pending Submissions: {pendingSubmissions}
              </span>
            </div>
            <button
              onClick={handleRefreshScores}
              disabled={isFetchingScores}
              className="flex items-center gap-2 text-primary hover:text-on-surface text-sm font-semibold font-body transition-colors disabled:opacity-50"
            >
              <RefreshCw size={14} className={isFetchingScores ? "animate-spin" : ""} />
              Refresh Now
            </button>
          </div>
          <span className="text-on-surface-variant text-sm font-body">
            Auto-refresh in {countdown}s
          </span>
        </motion.div>

        {/* Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
          <StatCard
            title="Current Quiz"
            value={quizTitle}
            subtext={`${totalQuestions} questions`}
            ghostIcon={FileText}
            accentClass="bg-primary"
            onClick={() => navigateTo("/admin/questions")}
            delay={0.1}
          />
          <StatCard
            title="Submissions"
            value={totalSubmissions}
            middleContent={
              meanPercent !== null ? (
                <div className="flex flex-col gap-1 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-on-surface-variant w-14">avg</span>
                    <span className="text-secondary font-semibold font-headline">{meanPercent}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-on-surface-variant w-14">median</span>
                    <span className="text-secondary font-semibold font-headline">{medianPercent}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-on-surface-variant w-14">skew</span>
                    <span className="text-secondary font-semibold font-headline">{skewnessPercent}</span>
                  </div>
                </div>
              ) : undefined
            }
            subtext={
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSubmittedModal(true);
                  }}
                  className="hover:underline"
                >
                  {totalSubmissions} submitted
                </button>
                {pendingSubmissions > 0 && (
                  <>
                    <span className="text-outline-variant">•</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowPendingModal(true);
                      }}
                      className="text-orange-400 hover:underline"
                    >
                      {pendingSubmissions} pending
                    </button>
                  </>
                )}
              </div>
            }
            ghostIcon={Trophy}
            accentClass="bg-secondary"
            onClick={() => navigateTo("/admin/scores")}
            delay={0.2}
          />
          <StatCard
            title="Students"
            value={totalStudents}
            middleContent={
              groupNames.length > 0 ? (
                <div className="space-y-0.5 py-1">
                  {groupNames.map((g) => (
                    <div key={g} className="text-xs text-tertiary/80 font-body">
                      {g}
                    </div>
                  ))}
                </div>
              ) : undefined
            }
            subtext="Enrolled students"
            ghostIcon={Users}
            accentClass="bg-tertiary"
            onClick={() => navigateTo("/admin/students")}
            delay={0.3}
          />

          {/* Archives card — custom layout to preserve bank links */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="relative overflow-hidden flex-1 p-6 rounded-2xl bg-surface-container hover:bg-surface-container-high transition-all hover:scale-[1.02] cursor-pointer text-left flex flex-col group"
            onClick={() => navigateTo("/admin/questions-bank")}
          >
            {/* Top accent strip */}
            <div className="absolute top-0 left-0 w-full h-0.5 bg-primary-dim/70" />

            {/* Ghost watermark */}
            <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:opacity-10 transition-opacity pointer-events-none">
              <Archive size={96} />
            </div>

            <p className="text-xs font-bold uppercase tracking-widest mb-4 font-body text-on-surface-variant">
              Archives
            </p>
            <div className="text-4xl font-bold tracking-tight leading-tight text-on-surface font-headline mb-2">
              {totalArchives}
            </div>

            <div className="flex-1 flex items-center">
            <div className="space-y-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigateTo("/admin/questions-bank");
                }}
                className="block text-xs text-primary hover:text-on-surface transition-colors hover:underline"
              >
                {questionBankFiles?.files?.length || 0} questions
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigateTo("/admin/scores-bank");
                }}
                className="block text-xs text-secondary hover:text-on-surface transition-colors hover:underline"
              >
                {scoresBankFiles?.files?.length || 0} scores
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigateTo("/admin/students-bank");
                }}
                className="block text-xs text-tertiary hover:text-on-surface transition-colors hover:underline"
              >
                {studentsBankFiles?.files?.length || 0} students
              </button>
            </div>
            </div>
          </motion.div>
        </div>

        {/* Bottom Nav Sections */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">

          {/* Quiz Management */}
          <section className="glass-panel rounded-2xl p-8 border border-white/5">
            <div className="flex items-center gap-3 mb-8">
              <FileText size={20} className="text-primary" />
              <h3 className="text-xl font-headline font-bold tracking-tight">
                Quiz Management
              </h3>
            </div>
            <ul className="space-y-4">
              {[
                { label: "Edit Questions",  path: "/admin/questions",      desc: "Modify quiz content and answers" },
                { label: "Question Bank",   path: "/admin/questions-bank", desc: "Save & load quiz templates" },
                { label: "Image Manager",   path: "/admin/images",         desc: "Upload & manage quiz images" },
              ].map(({ label, path }) => (
                <li
                  key={path}
                  onClick={() => navigateTo(path)}
                  className="flex items-center justify-between group cursor-pointer hover:translate-x-2 transition-transform py-1"
                >
                  <span className="text-on-surface-variant group-hover:text-primary transition-colors text-sm font-body">
                    {label}
                  </span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="opacity-0 group-hover:opacity-100 text-primary transition-opacity"
                  >
                    <path d="m9 18 6-6-6-6"/>
                  </svg>
                </li>
              ))}
            </ul>
          </section>

          {/* Results & Scoring */}
          <section className="glass-panel rounded-2xl p-8 border border-white/5">
            <div className="flex items-center gap-3 mb-8">
              <BarChart3 size={20} className="text-secondary" />
              <h3 className="text-xl font-headline font-bold tracking-tight">
                Results & Scoring
              </h3>
            </div>
            <ul className="space-y-4">
              {[
                { label: "View Scores",        path: "/admin/scores" },
                { label: "Scores Archive",      path: "/admin/scores-bank" },
                { label: "Review Bank Scores",  path: "/admin/scores-bank-review" },
              ].map(({ label, path }) => (
                <li
                  key={path}
                  onClick={() => navigateTo(path)}
                  className="flex items-center justify-between group cursor-pointer hover:translate-x-2 transition-transform py-1"
                >
                  <span className="text-on-surface-variant group-hover:text-secondary transition-colors text-sm font-body">
                    {label}
                  </span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="opacity-0 group-hover:opacity-100 text-secondary transition-opacity"
                  >
                    <path d="m9 18 6-6-6-6"/>
                  </svg>
                </li>
              ))}
            </ul>
          </section>

          {/* Student Management */}
          <section className="glass-panel rounded-2xl p-8 border border-white/5">
            <div className="flex items-center gap-3 mb-8">
              <Users size={20} className="text-tertiary" />
              <h3 className="text-xl font-headline font-bold tracking-tight">
                Student Management
              </h3>
            </div>
            <ul className="space-y-4">
              {[
                { label: "Manage Students",  path: "/admin/students" },
                { label: "Students Archive", path: "/admin/students-bank" },
              ].map(({ label, path }) => (
                <li
                  key={path}
                  onClick={() => navigateTo(path)}
                  className="flex items-center justify-between group cursor-pointer hover:translate-x-2 transition-transform py-1"
                >
                  <span className="text-on-surface-variant group-hover:text-tertiary transition-colors text-sm font-body">
                    {label}
                  </span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="opacity-0 group-hover:opacity-100 text-tertiary transition-opacity"
                  >
                    <path d="m9 18 6-6-6-6"/>
                  </svg>
                </li>
              ))}
            </ul>
          </section>

        </div>
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}

      {/* Pending Submissions Modal */}
      {showPendingModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-surface-container rounded-xl border border-outline-variant/20 max-w-2xl w-full max-h-[80vh] overflow-hidden"
          >
            <div className="bg-orange-500/20 border-b border-orange-500/30 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold text-orange-400 font-headline">
                Pending Submissions ({pendingSubmissions})
              </h2>
              <button
                onClick={() => setShowPendingModal(false)}
                className="text-on-surface-variant hover:text-on-surface text-2xl font-bold"
              >
                ×
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {pendingStudentEmails.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-on-surface-variant text-sm mb-4 font-body">
                    The following students have not submitted their quiz yet:
                  </p>
                  <ul className="space-y-1">
                    {pendingStudentEmails.map((email, index) => (
                      <li
                        key={index}
                        className="px-4 py-2 bg-orange-500/10 border border-orange-500/20 rounded-lg text-on-surface hover:bg-orange-500/20 transition-colors font-body text-sm"
                      >
                        {email}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-on-surface-variant text-center py-8 font-body">
                  All students have submitted their quiz! 🎉
                </p>
              )}
            </div>
            <div className="bg-surface-container-low px-6 py-4 flex justify-end border-t border-outline-variant/20">
              <button
                onClick={() => setShowPendingModal(false)}
                className="px-6 py-2 bg-orange-500/20 border border-orange-500/30 text-orange-400 rounded-lg hover:bg-orange-500/30 transition-colors font-medium font-body"
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Submitted Students Modal */}
      {showSubmittedModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-surface-container rounded-xl border border-outline-variant/20 max-w-2xl w-full max-h-[80vh] overflow-hidden"
          >
            <div className="bg-tertiary/20 border-b border-tertiary/30 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold text-tertiary font-headline">
                Submitted Students ({totalSubmissions})
              </h2>
              <button
                onClick={() => setShowSubmittedModal(false)}
                className="text-on-surface-variant hover:text-on-surface text-2xl font-bold"
              >
                ×
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {submittedStudentEmails.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-on-surface-variant text-sm mb-4 font-body">
                    The following students have successfully submitted their quiz:
                  </p>
                  <ul className="space-y-1">
                    {submittedStudentEmails.map((email, index) => (
                      <li
                        key={index}
                        className="px-4 py-2 bg-tertiary/10 border border-tertiary/20 rounded-lg text-on-surface hover:bg-tertiary/20 transition-colors font-body text-sm"
                      >
                        {email}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-on-surface-variant text-center py-8 font-body">
                  No submissions yet.
                </p>
              )}
            </div>
            <div className="bg-surface-container-low px-6 py-4 flex justify-end border-t border-outline-variant/20">
              <button
                onClick={() => setShowSubmittedModal(false)}
                className="px-6 py-2 bg-tertiary/20 border border-tertiary/30 text-tertiary rounded-lg hover:bg-tertiary/30 transition-colors font-medium font-body"
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Sync Modal */}
      {showSyncModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-surface-container rounded-xl border border-outline-variant/20 max-w-lg w-full overflow-hidden"
          >
            <div
              className={`${
                syncError
                  ? "bg-error/20 border-b border-error/30"
                  : "bg-primary/10 border-b border-primary/20"
              } px-6 py-4 flex justify-between items-center`}
            >
              <h2
                className={`text-xl font-bold font-headline ${
                  syncError ? "text-error" : "text-primary"
                }`}
              >
                {syncError ? "❌ Sync Failed" : "✅ Sync Complete"}
              </h2>
              <button
                onClick={() => setShowSyncModal(false)}
                className="text-on-surface-variant hover:text-on-surface text-2xl font-bold"
              >
                ×
              </button>
            </div>
            <div className="p-6">
              {syncError ? (
                <div className="text-error bg-error/10 p-4 rounded-lg border border-error/20">
                  <p className="font-semibold mb-2 font-body">Error:</p>
                  <p className="whitespace-pre-wrap font-body text-sm">{syncError}</p>
                </div>
              ) : (
                <div className="text-primary bg-primary/10 p-4 rounded-lg border border-primary/20">
                  <p className="whitespace-pre-wrap font-body text-sm">{syncMessage}</p>
                </div>
              )}
              {syncStatus && (
                <div className="mt-4 p-4 bg-surface-container-low rounded-lg border border-outline-variant/20 text-sm">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-on-surface-variant font-body">Status:</span>
                      <span className="font-medium font-body">
                        {syncStatus.initialized ? "✓ Initialized" : "○ Not initialized"}
                      </span>
                    </div>
                    {syncStatus.last_commit && (
                      <div className="flex justify-between">
                        <span className="text-on-surface-variant font-body">Last commit:</span>
                        <span className="font-medium text-xs font-body">
                          {syncStatus.last_commit}
                        </span>
                      </div>
                    )}
                    {syncStatus.remote_url && (
                      <div className="flex justify-between">
                        <span className="text-on-surface-variant font-body">Remote:</span>
                        <span className="font-medium text-xs font-body">
                          {syncStatus.remote_url}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="bg-surface-container-low px-6 py-4 flex justify-end border-t border-outline-variant/20">
              <button
                onClick={() => setShowSyncModal(false)}
                className={`px-6 py-2 ${
                  syncError
                    ? "bg-error/20 border border-error/30 text-error hover:bg-error/30"
                    : "bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20"
                } rounded-lg transition-colors font-medium font-body`}
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AdminLayout>
  );
}
