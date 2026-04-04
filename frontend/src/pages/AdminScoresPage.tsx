// frontend/src/pages/AdminDashboardPage.tsx
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchScores, ScoreEntry, recalculateAllScores, sendResultEmail, sendAllResultEmails, clearScores, restoreScores } from "../api";
import { slugify } from "../lib/utils";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorDisplay from "../components/ErrorDisplay";
import SubmissionDetailView from "../components/SubmissionDetailView";
import AdminLayout from "../layouts/AdminLayout";

function AdminDashboardPage() {
  const location = useLocation();
  const queryClient = useQueryClient();
  // Attempt to get password from navigation state (insecure, lost on refresh)
  const adminPassword = location.state?.adminPassword;
  const [selectedStudent, setSelectedStudent] = useState<ScoreEntry | null>(
    null,
  );
  const [csvError, setCsvError] = useState<string | null>(null);
  const [recalculateMessage, setRecalculateMessage] = useState<string | null>(null);
  const [emailModal, setEmailModal] = useState<{ studentEmail: string; quizId: string } | null>(null);
  const [bulkEmailModal, setBulkEmailModal] = useState<boolean>(false);
  const [emailSubject, setEmailSubject] = useState<string>("");
  const [includeDetails, setIncludeDetails] = useState<boolean>(true);
  const [showRecalculateConfirm, setShowRecalculateConfirm] = useState<boolean>(false);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState<boolean>(false);
  const [emailSubjectError, setEmailSubjectError] = useState<string | null>(null);

  // Fetch scores using the password
  const {
    data: scores,
    isLoading,
    error,
    isError,
  } = useQuery<ScoreEntry[], Error>({
    queryKey: ["adminScores", adminPassword], // Include password in key if needed? Or fetch once?
    queryFn: () => {
      if (!adminPassword) throw new Error("Admin password not provided.");
      return fetchScores(adminPassword);
    },
    enabled: !!adminPassword, // Only fetch if password exists
    staleTime: 5 * 60 * 1000, // Cache scores for 5 minutes
  });

  // Mutation for recalculating scores
  const recalculateMutation = useMutation({
    mutationFn: () => {
      if (!adminPassword) throw new Error("Admin password not provided.");
      return recalculateAllScores(adminPassword);
    },
    onSuccess: (data) => {
      setRecalculateMessage(
        `✓ ${data.message}${data.errors.length > 0 ? ` Errors: ${data.errors.join(", ")}` : ""}`
      );
      setShowRecalculateConfirm(false);
      // Invalidate and refetch scores
      queryClient.invalidateQueries({ queryKey: ["adminScores", adminPassword] });
    },
    onError: (err: Error) => {
      setRecalculateMessage(`✗ Failed to recalculate scores: ${err.message}`);
      setShowRecalculateConfirm(false);
    },
  });

  // Mutation for sending all emails
  const sendAllEmailsMutation = useMutation({
    mutationFn: ({ subject, includeDetails }: { subject: string; includeDetails: boolean }) => {
      if (!adminPassword) throw new Error("Admin password not provided.");
      return sendAllResultEmails(adminPassword, subject, includeDetails);
    },
    onSuccess: (data) => {
      setRecalculateMessage(
        `✓ ${data.message}${data.errors.length > 0 ? ` Errors: ${data.errors.slice(0, 3).join(", ")}` : ""}`
      );
      setBulkEmailModal(false);
      setEmailSubject("");
      setIncludeDetails(true);
    },
    onError: (err: Error) => {
      setRecalculateMessage(`✗ Failed to send emails: ${err.message}`);
      setBulkEmailModal(false);
      setEmailSubject("");
      setIncludeDetails(true);
    },
  });

  // Mutation for clearing scores
  const clearScoresMutation = useMutation({
    mutationFn: () => {
      if (!adminPassword) throw new Error("Admin password not provided.");
      return clearScores(adminPassword);
    },
    onSuccess: (data) => {
      setRecalculateMessage(`✓ ${data.message}`);
      setShowClearConfirm(false);
      // Invalidate and refetch scores
      queryClient.invalidateQueries({ queryKey: ["adminScores", adminPassword] });
    },
    onError: (err: Error) => {
      setRecalculateMessage(`✗ Failed to clear scores: ${err.message}`);
      setShowClearConfirm(false);
    },
  });

  // Mutation for restoring scores
  const restoreScoresMutation = useMutation({
    mutationFn: () => {
      if (!adminPassword) throw new Error("Admin password not provided.");
      return restoreScores(adminPassword);
    },
    onSuccess: (data) => {
      setRecalculateMessage(`✓ ${data.message}`);
      setShowRestoreConfirm(false);
      // Invalidate and refetch scores
      queryClient.invalidateQueries({ queryKey: ["adminScores", adminPassword] });
    },
    onError: (err: Error) => {
      setRecalculateMessage(`✗ Failed to restore scores: ${err.message}`);
      setShowRestoreConfirm(false);
    },
  });

  const sendSingleEmailMutation = useMutation({
    mutationFn: ({ studentEmail, quizId, subject, includeDetails }: { studentEmail: string; quizId: string; subject: string; includeDetails: boolean }) => {
      if (!adminPassword) throw new Error("Admin password not provided.");
      return sendResultEmail(studentEmail, quizId, adminPassword, subject, includeDetails);
    },
    onSuccess: (_data, variables) => {
      setRecalculateMessage(`✓ Email sent to ${variables.studentEmail}`);
      setEmailModal(null);
      setEmailSubject("");
      setIncludeDetails(true);
    },
    onError: (err: Error, variables) => {
      setRecalculateMessage(`✗ Failed to send email to ${variables.studentEmail}: ${err.message}`);
      setEmailModal(null);
      setEmailSubject("");
      setIncludeDetails(true);
    },
  });

  const handleSendSingleEmail = (studentEmail: string, quizId: string, quizTitle?: string) => {
    // Open modal to ask for subject
    setEmailModal({ studentEmail, quizId });
    // Use quiz title if available, otherwise use quiz_id
    const defaultSubject = quizTitle ? `Risultati - ${quizTitle}` : `Quiz Results - ${quizId}`;
    setEmailSubject(defaultSubject);
    setIncludeDetails(true);
  };

  const handleConfirmSendEmail = () => {
    if (!emailModal) return;
    if (!emailSubject.trim()) {
      setEmailSubjectError("Please enter an email subject");
      return;
    }
    setEmailSubjectError(null);
    setRecalculateMessage(null);
    sendSingleEmailMutation.mutate({
      studentEmail: emailModal.studentEmail,
      quizId: emailModal.quizId,
      subject: emailSubject,
      includeDetails: includeDetails
    });
  };

  const handleRecalculateScores = () => {
    setShowRecalculateConfirm(true);
  };

  const handleConfirmRecalculate = () => {
    setRecalculateMessage(null);
    recalculateMutation.mutate();
  };

  const handleCancelRecalculate = () => {
    setShowRecalculateConfirm(false);
  };

  const handleSendAllEmails = () => {
    // Open modal to ask for subject
    setBulkEmailModal(true);
    setEmailSubject("Quiz Results");
    setIncludeDetails(true);
  };

  const handleConfirmSendAllEmails = () => {
    if (!emailSubject.trim()) {
      setEmailSubjectError("Please enter an email subject");
      return;
    }
    setEmailSubjectError(null);
    setRecalculateMessage(null);
    sendAllEmailsMutation.mutate({ subject: emailSubject, includeDetails: includeDetails });
  };

  const handleClearScores = () => {
    setShowClearConfirm(true);
  };

  const handleConfirmClear = () => {
    setRecalculateMessage(null);
    clearScoresMutation.mutate();
  };

  const handleCancelClear = () => {
    setShowClearConfirm(false);
  };

  const handleRestoreScores = () => {
    setShowRestoreConfirm(true);
  };

  const handleConfirmRestore = () => {
    setRecalculateMessage(null);
    restoreScoresMutation.mutate();
  };

  const handleCancelRestore = () => {
    setShowRestoreConfirm(false);
  };

  // --- CSV Export Function ---
  const handleExportCSV = () => {
    // *** Clear previous CSV error ***
    setCsvError(null);

    if (!scores || scores.length === 0) {
      // *** Use Error State instead of alert ***
      setCsvError("No scores available to export.");
      return;
    }

    // Generate filename based on quiz title if available
    const quizTitle = scores.every(s => s.quiz_title === scores[0].quiz_title)
      ? scores[0].quiz_title
      : null;

    const now = new Date();
    const datePrefix = now.toISOString().split('T')[0]; // YYYY-MM-DD format

    const filename = quizTitle
      ? `${datePrefix}_${slugify(quizTitle)}_scores.csv`
      : `${datePrefix}_quiz_scores_export.csv`;

    // Define CSV Columns and Header (Timestamp, Student ID, Score)
    const maxScore = scores[0].max_points;
    const header = [
      "Timestamp",
      "Student ID",
      `Score max: ${maxScore}`,
      "Percentage",
    ];
    const rows = scores.map((entry) => {
      // Format the score column (e.g., "raw/max")
      const scoreString = `${entry.raw_points}`;
      // Format timestamp nicely if needed, otherwise use ISO string
      const timestamp = new Date(entry.timestamp).toLocaleString(); // Or entry.timestamp for ISO

      // Handle potential commas/quotes in student ID by enclosing in quotes
      // Basic CSV escaping: double quotes inside fields are doubled
      const escapeCSV = (field: string | number) => {
        const stringField = String(field);
        if (
          stringField.includes(",") ||
          stringField.includes('"') ||
          stringField.includes("\n")
        ) {
          return `"${stringField.replace(/"/g, '""')}"`;
        }
        return stringField;
      };

      return [
        escapeCSV(timestamp),
        escapeCSV(entry.student),
        escapeCSV(scoreString),
        escapeCSV(entry.percent), // Add percentage column
      ];
    });

    // Combine header and rows
    const csvContent = [
      header.join(","),
      ...rows.map((row) => row.join(",")),
    ].join("\n");

    // Create Blob and trigger download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    if (link.download !== undefined) {
      // Feature detection
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", filename);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url); // Clean up
    } else {
      // *** Use Error State instead of alert ***
      setCsvError("CSV export is not supported in your browser.");
    }
  };
  // --- End CSV Export Function ---

  // --- Render Logic ---
  if (!adminPassword) {
    // Handle case where password state is lost (e.g., refresh)
    // Redirect back to login or show message
    return (
      <ErrorDisplay message="Admin session invalid. Please login again." />
    );
    // navigate('/admin'); // Or redirect
  }

  if (isLoading) return <LoadingSpinner />;
  if (isError)
    return (
      <ErrorDisplay message={`Failed to load scores: ${error?.message}`} />
    );

  // Extract quiz title if all submissions are from the same quiz
  const quizTitle = scores && scores.length > 0
    ? scores.every(s => s.quiz_title === scores[0].quiz_title)
      ? scores[0].quiz_title
      : null
    : null;

  return (
    <AdminLayout activePath="/admin/scores" adminPassword={adminPassword} pageTitle="Scores" titleClassName="from-secondary to-secondary/60">
      <div className="space-y-6">
        <div className="flex justify-between items-center mb-2">
          {/* Reduced bottom margin */}
          <h2 className="text-2xl font-semibold text-on-surface">
            Submitted Scores
            {quizTitle && <span className="text-on-surface-variant font-normal"> - {quizTitle}</span>}
          </h2>
          <div className="flex gap-2">
            <button
              onClick={handleSendAllEmails}
              disabled={!scores || scores.length === 0 || sendAllEmailsMutation.isPending}
              className="px-4 py-2 bg-primary text-on-primary text-sm font-bold rounded-lg shadow-[0_0_15px_rgba(129,236,255,0.3)] hover:shadow-[0_0_20px_rgba(129,236,255,0.5)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sendAllEmailsMutation.isPending ? "Sending..." : "📧 Email All Results"}
            </button>
            {/* Recalculate Button with Inline Confirmation */}
            {showRecalculateConfirm ? (
              <span className="flex gap-2 items-center bg-surface-container-high border border-outline-variant/30 rounded-lg px-3 py-2">
                <span className="text-sm text-on-surface">Re-grade all submissions?</span>
                <button
                  onClick={handleConfirmRecalculate}
                  className="bg-primary text-on-primary px-3 py-1 text-sm font-bold rounded-lg hover:bg-primary/80 transition-colors"
                  disabled={recalculateMutation.isPending}
                >
                  {recalculateMutation.isPending ? "Recalculating..." : "Yes"}
                </button>
                <button
                  onClick={handleCancelRecalculate}
                  className="bg-surface-container-high border border-outline-variant/30 text-on-surface-variant px-3 py-1 text-sm font-bold rounded-lg hover:bg-surface-bright transition-colors"
                  disabled={recalculateMutation.isPending}
                >
                  No
                </button>
              </span>
            ) : (
              <button
                onClick={handleRecalculateScores}
                disabled={!scores || scores.length === 0 || recalculateMutation.isPending}
                className="px-4 py-2 bg-surface-container-high border border-primary/30 text-primary text-sm font-bold rounded-lg hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Recalculate All Scores
              </button>
            )}
            <button
              onClick={handleExportCSV}
              disabled={!scores || scores.length === 0}
                className="px-4 py-2 bg-surface-container-high border border-secondary/30 text-secondary text-sm font-bold rounded-lg hover:bg-secondary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Export to CSV
            </button>
            {/* Clear Scores Button with Inline Confirmation */}
            {showClearConfirm ? (
              <span className="flex gap-2 items-center bg-surface-container-high border border-outline-variant/30 rounded-lg px-3 py-2">
                <span className="text-sm text-on-surface">Clear all scores?</span>
                <button
                  onClick={handleConfirmClear}
                  className="bg-error/20 border border-error/30 text-error px-3 py-1 text-sm font-bold rounded-lg hover:bg-error/30 transition-colors"
                  disabled={clearScoresMutation.isPending}
                >
                  {clearScoresMutation.isPending ? "Clearing..." : "Yes"}
                </button>
                <button
                  onClick={handleCancelClear}
                  className="bg-surface-container-high border border-outline-variant/30 text-on-surface-variant px-3 py-1 text-sm font-bold rounded-lg hover:bg-surface-bright transition-colors"
                  disabled={clearScoresMutation.isPending}
                >
                  No
                </button>
              </span>
            ) : (
              <button
                onClick={handleClearScores}
                disabled={!scores || scores.length === 0 || clearScoresMutation.isPending}
                className="px-4 py-2 bg-error/20 border border-error/30 text-error text-sm font-bold rounded-lg hover:bg-error/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                🗑️ Clear All Scores
              </button>
            )}
            {/* Restore Scores Button with Inline Confirmation */}
            {showRestoreConfirm ? (
              <span className="flex gap-2 items-center bg-surface-container-high border border-outline-variant/30 rounded-lg px-3 py-2">
                <span className="text-sm text-on-surface">Restore from backup?</span>
                <button
                  onClick={handleConfirmRestore}
                  className="bg-orange-500/20 border border-orange-500/30 text-orange-400 px-3 py-1 text-sm font-bold rounded-lg hover:bg-orange-500/30 transition-colors"
                  disabled={restoreScoresMutation.isPending}
                >
                  {restoreScoresMutation.isPending ? "Restoring..." : "Yes"}
                </button>
                <button
                  onClick={handleCancelRestore}
                  className="bg-surface-container-high border border-outline-variant/30 text-on-surface-variant px-3 py-1 text-sm font-bold rounded-lg hover:bg-surface-bright transition-colors"
                  disabled={restoreScoresMutation.isPending}
                >
                  No
                </button>
              </span>
            ) : (
              <button
                onClick={handleRestoreScores}
                disabled={restoreScoresMutation.isPending}
                className="px-4 py-2 bg-orange-500/20 border border-orange-500/30 text-orange-400 text-sm font-bold rounded-lg hover:bg-orange-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ↩️ Restore Scores
              </button>
            )}
          </div>
        </div>

        {/* *** ADDED: Display CSV Export Errors *** */}
        <ErrorDisplay message={csvError} />

        {/* Display Recalculate Message */}
        {recalculateMessage && (
          <div className={`px-4 py-3 rounded-lg ${recalculateMessage.startsWith('✓') ? 'bg-tertiary/10 border border-tertiary/20 text-tertiary' : 'bg-error/10 border border-error/20 text-error'}`}>
            {recalculateMessage}
          </div>
        )}

        {scores && scores.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-outline-variant/20">
            <table className="min-w-full">
              <thead className="bg-surface-container-low">
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-on-surface-variant uppercase tracking-wider"
                  >
                    Student
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-on-surface-variant uppercase tracking-wider"
                  >
                    Quiz
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-on-surface-variant uppercase tracking-wider"
                  >
                    Score
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-on-surface-variant uppercase tracking-wider"
                  >
                    Percent
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-on-surface-variant uppercase tracking-wider"
                  >
                    Timestamp
                  </th>
                  <th scope="col" className="relative px-6 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/10">
                {scores.map((entry) => (
                  <tr key={entry.quiz_id} className="hover:bg-surface-container-high border-b border-outline-variant/10">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-on-surface">
                      {entry.student}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-on-surface-variant">
                      {entry.quiz_title ? (
                        <div>
                          <div className="font-medium text-on-surface">{entry.quiz_title}</div>
                          <div className="text-xs text-on-surface-variant/60">{entry.quiz_id}</div>
                        </div>
                      ) : (
                        entry.quiz_id
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-on-surface-variant">
                      {entry.raw_points} / {entry.max_points}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-on-surface-variant">
                      {entry.percent}%
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-on-surface-variant">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                      <button
                        onClick={() => handleSendSingleEmail(entry.student, entry.quiz_id, entry.quiz_title)}
                        disabled={sendSingleEmailMutation.isPending}
                        className="px-3 py-1.5 bg-primary/10 border border-primary/30 text-primary text-xs font-bold rounded-lg hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Send email to this student"
                      >
                        📧 Email
                      </button>
                      <button
                        onClick={() => setSelectedStudent(entry)}
                        className="px-3 py-1.5 bg-secondary/10 border border-secondary/30 text-secondary text-xs font-bold rounded-lg hover:bg-secondary/20 transition-colors"
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-on-surface-variant">No scores submitted yet.</p>
        )}

        {/* Conditionally render detail view */}
        {selectedStudent && (
          <SubmissionDetailView
            studentSubmission={selectedStudent}
            adminPassword={adminPassword} // Pass password for detail fetch/override save
            onClose={() => setSelectedStudent(null)} // Allow closing the detail view
          />
        )}

        {/* Email Subject Modal */}
        {emailModal && (
          <div className="fixed inset-0 backdrop-blur-sm bg-black/60 flex items-center justify-center z-50">
            <div className="bg-surface-container border border-outline-variant/20 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold text-on-surface mb-4">Send Quiz Results</h3>
              <p className="text-sm text-on-surface-variant mb-4">
                Sending to: <span className="font-medium text-on-surface">{emailModal.studentEmail}</span>
              </p>
              {emailSubjectError && (
                <div className="mb-4 p-3 bg-error/10 border border-error/20 text-error rounded-lg text-sm">
                  {emailSubjectError}
                </div>
              )}
              <div className="mb-4">
                <label htmlFor="email-subject" className="block text-sm font-medium text-on-surface mb-2">
                  Email Subject:
                </label>
                <input
                  id="email-subject"
                  type="text"
                  value={emailSubject}
                  onChange={(e) => {
                    setEmailSubject(e.target.value);
                    setEmailSubjectError(null);
                  }}
                  className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant/30 text-on-surface rounded-lg focus:border-primary/50 focus:outline-none"
                  placeholder="Enter email subject"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleConfirmSendEmail();
                    } else if (e.key === 'Escape') {
                      setEmailModal(null);
                      setEmailSubject("");
                      setEmailSubjectError(null);
                    }
                  }}
                />
              </div>
              <div className="mb-4">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeDetails}
                    onChange={(e) => setIncludeDetails(e.target.checked)}
                    className="w-4 h-4 bg-surface-container-low border border-outline-variant/30 rounded text-primary focus:ring-2 focus:ring-primary/50"
                  />
                  <span className="text-sm text-on-surface-variant">Include detailed question-by-question results</span>
                </label>
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setEmailModal(null);
                    setEmailSubject("");
                    setEmailSubjectError(null);
                  }}
                  className="px-4 py-2 bg-surface-container-high border border-outline-variant/30 text-on-surface-variant text-sm font-bold rounded-lg hover:bg-surface-bright transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmSendEmail}
                  disabled={sendSingleEmailMutation.isPending || !emailSubject.trim()}
                  className="px-4 py-2 bg-primary text-on-primary text-sm font-bold rounded-lg shadow-[0_0_15px_rgba(129,236,255,0.3)] hover:shadow-[0_0_20px_rgba(129,236,255,0.5)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sendSingleEmailMutation.isPending ? "Sending..." : "Send Email"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bulk Email Subject Modal */}
        {bulkEmailModal && (
          <div className="fixed inset-0 backdrop-blur-sm bg-black/60 flex items-center justify-center z-50">
            <div className="bg-surface-container border border-outline-variant/20 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold text-on-surface mb-4">Send Quiz Results to All Students</h3>
              <p className="text-sm text-on-surface-variant mb-4">
                This will send emails to <span className="font-medium text-on-surface">{scores?.length || 0} students</span>
              </p>
              {emailSubjectError && (
                <div className="mb-4 p-3 bg-error/10 border border-error/20 text-error rounded-lg text-sm">
                  {emailSubjectError}
                </div>
              )}
              <div className="mb-4">
                <label htmlFor="bulk-email-subject" className="block text-sm font-medium text-on-surface mb-2">
                  Email Subject:
                </label>
                <input
                  id="bulk-email-subject"
                  type="text"
                  value={emailSubject}
                  onChange={(e) => {
                    setEmailSubject(e.target.value);
                    setEmailSubjectError(null);
                  }}
                  className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant/30 text-on-surface rounded-lg focus:border-primary/50 focus:outline-none"
                  placeholder="Enter email subject"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleConfirmSendAllEmails();
                    } else if (e.key === 'Escape') {
                      setBulkEmailModal(false);
                      setEmailSubject("");
                      setEmailSubjectError(null);
                    }
                  }}
                />
              </div>
              <div className="mb-4">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeDetails}
                    onChange={(e) => setIncludeDetails(e.target.checked)}
                    className="w-4 h-4 bg-surface-container-low border border-outline-variant/30 rounded text-primary focus:ring-2 focus:ring-primary/50"
                  />
                  <span className="text-sm text-on-surface-variant">Include detailed question-by-question results</span>
                </label>
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setBulkEmailModal(false);
                    setEmailSubject("");
                    setEmailSubjectError(null);
                  }}
                  className="px-4 py-2 bg-surface-container-high border border-outline-variant/30 text-on-surface-variant text-sm font-bold rounded-lg hover:bg-surface-bright transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmSendAllEmails}
                  disabled={sendAllEmailsMutation.isPending || !emailSubject.trim()}
                  className="px-4 py-2 bg-primary text-on-primary text-sm font-bold rounded-lg shadow-[0_0_15px_rgba(129,236,255,0.3)] hover:shadow-[0_0_20px_rgba(129,236,255,0.5)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sendAllEmailsMutation.isPending ? "Sending..." : `Send to ${scores?.length || 0} Students`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
export default AdminDashboardPage;
