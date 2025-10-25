// frontend/src/pages/AdminDashboardPage.tsx
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom"; // Import useNavigate
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchScores, ScoreEntry, recalculateAllScores, sendResultEmail, sendAllResultEmails } from "../api"; // Import API and type
// Assume helper components exist
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorDisplay from "../components/ErrorDisplay";
// Conceptual: Component to show details when a row is clicked
import SubmissionDetailView from "../components/SubmissionDetailView";

function AdminDashboardPage() {
  const location = useLocation();
  const navigate = useNavigate(); // Initialize useNavigate
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
      // Invalidate and refetch scores
      queryClient.invalidateQueries({ queryKey: ["adminScores", adminPassword] });
    },
    onError: (err: Error) => {
      setRecalculateMessage(`✗ Failed to recalculate scores: ${err.message}`);
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

  const handleSendSingleEmail = (studentEmail: string, quizId: string) => {
    // Open modal to ask for subject
    setEmailModal({ studentEmail, quizId });
    setEmailSubject(`Quiz Results - ${quizId}`);
    setIncludeDetails(true);
  };

  const handleConfirmSendEmail = () => {
    if (!emailModal) return;
    if (!emailSubject.trim()) {
      alert("Please enter an email subject");
      return;
    }
    setRecalculateMessage(null);
    sendSingleEmailMutation.mutate({
      studentEmail: emailModal.studentEmail,
      quizId: emailModal.quizId,
      subject: emailSubject,
      includeDetails: includeDetails
    });
  };

  const handleRecalculateScores = () => {
    if (window.confirm("This will re-grade all submissions against the current question bank. Continue?")) {
      setRecalculateMessage(null);
      recalculateMutation.mutate();
    }
  };

  const handleSendAllEmails = () => {
    // Open modal to ask for subject
    setBulkEmailModal(true);
    setEmailSubject("Quiz Results");
    setIncludeDetails(true);
  };

  const handleConfirmSendAllEmails = () => {
    if (!emailSubject.trim()) {
      alert("Please enter an email subject");
      return;
    }
    setRecalculateMessage(null);
    sendAllEmailsMutation.mutate({ subject: emailSubject, includeDetails: includeDetails });
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
      link.setAttribute("download", "quiz_scores_export.csv");
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

  return (
    <div className="space-y-6">
      <div className="flex justify-end items-center mb-2">
        {/* Reduced bottom margin */}
        <button
          onClick={() => {
            navigate("/admin/dashboard", {
              state: { adminPassword: adminPassword },
            });
          }}
          className="px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Go to admin dashboard
        </button>
      </div>

      <div className="flex justify-between items-center mb-2">
        {/* Reduced bottom margin */}
        <h2 className="text-2xl font-semibold">Submitted Scores</h2>
        <div className="flex gap-2">
          <button
            onClick={handleSendAllEmails}
            disabled={!scores || scores.length === 0 || sendAllEmailsMutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sendAllEmailsMutation.isPending ? "Sending..." : "📧 Email All Results"}
          </button>
          <button
            onClick={handleRecalculateScores}
            disabled={!scores || scores.length === 0 || recalculateMutation.isPending}
            className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {recalculateMutation.isPending ? "Recalculating..." : "Recalculate All Scores"}
          </button>
          <button
            onClick={handleExportCSV}
            disabled={!scores || scores.length === 0}
            className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Export to CSV
          </button>
        </div>
      </div>

      {/* *** ADDED: Display CSV Export Errors *** */}
      <ErrorDisplay message={csvError} />

      {/* Display Recalculate Message */}
      {recalculateMessage && (
        <div className={`p-3 rounded-md mb-4 ${recalculateMessage.startsWith('✓') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {recalculateMessage}
        </div>
      )}

      {scores && scores.length > 0 ? (
        <div className="overflow-x-auto shadow rounded-lg border">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Student
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Quiz ID
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Score
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Percent
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Timestamp
                </th>
                <th scope="col" className="relative px-6 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {scores.map((entry) => (
                <tr key={entry.quiz_id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {entry.student}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {entry.quiz_id}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {entry.raw_points} / {entry.max_points}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {entry.percent}%
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(entry.timestamp + 'Z').toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                    <button
                      onClick={() => handleSendSingleEmail(entry.student, entry.quiz_id)}
                      disabled={sendSingleEmailMutation.isPending}
                      className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Send email to this student"
                    >
                      📧 Email
                    </button>
                    <button
                      onClick={() => setSelectedStudent(entry)}
                      className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
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
        <p>No scores submitted yet.</p>
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Send Quiz Results</h3>
            <p className="text-sm text-gray-600 mb-4">
              Sending to: <span className="font-medium">{emailModal.studentEmail}</span>
            </p>
            <div className="mb-4">
              <label htmlFor="email-subject" className="block text-sm font-medium text-gray-700 mb-2">
                Email Subject:
              </label>
              <input
                id="email-subject"
                type="text"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter email subject"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleConfirmSendEmail();
                  } else if (e.key === 'Escape') {
                    setEmailModal(null);
                    setEmailSubject("");
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
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Include detailed question-by-question results</span>
              </label>
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setEmailModal(null);
                  setEmailSubject("");
                }}
                className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSendEmail}
                disabled={sendSingleEmailMutation.isPending || !emailSubject.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sendSingleEmailMutation.isPending ? "Sending..." : "Send Email"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Email Subject Modal */}
      {bulkEmailModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Send Quiz Results to All Students</h3>
            <p className="text-sm text-gray-600 mb-4">
              This will send emails to <span className="font-medium">{scores?.length || 0} students</span>
            </p>
            <div className="mb-4">
              <label htmlFor="bulk-email-subject" className="block text-sm font-medium text-gray-700 mb-2">
                Email Subject:
              </label>
              <input
                id="bulk-email-subject"
                type="text"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter email subject"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleConfirmSendAllEmails();
                  } else if (e.key === 'Escape') {
                    setBulkEmailModal(false);
                    setEmailSubject("");
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
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Include detailed question-by-question results</span>
              </label>
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setBulkEmailModal(false);
                  setEmailSubject("");
                }}
                className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSendAllEmails}
                disabled={sendAllEmailsMutation.isPending || !emailSubject.trim()}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sendAllEmailsMutation.isPending ? "Sending..." : `Send to ${scores?.length || 0} Students`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default AdminDashboardPage;
