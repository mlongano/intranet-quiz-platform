// frontend/src/components/SubmissionDetailView.tsx
import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ScoreEntry, saveScoreOverrides, OverridePayload } from "../api"; // Import API functions and types
import LoadingSpinner from "./LoadingSpinner"; // Assuming this exists
import ErrorDisplay from "./ErrorDisplay"; // Assuming this exists

interface Props {
  studentSubmission: ScoreEntry | null; // Allow null to handle deselection easily
  adminPassword: string; // Needed for the save API call
  onClose: () => void; // Function to close this detail view
}

function SubmissionDetailView({
  studentSubmission,
  adminPassword,
  onClose,
}: Props) {
  const queryClient = useQueryClient();
  // State to hold the score overrides keyed by question_id
  const [overrides, setOverrides] = useState<Record<string | number, number>>(
    {},
  );
  // State for displaying saving errors or success messages
  const [saveStatus, setSaveStatus] = useState<{
    error?: string | null;
    success?: string | null;
  }>({});

  // Effect to reset overrides when the selected submission changes
  useEffect(() => {
    setOverrides({}); // Clear overrides when a new student is selected or deselected
    setSaveStatus({}); // Clear status messages
  }, [studentSubmission]);

  // Mutation hook for saving the overrides
  const saveMutation = useMutation({
    mutationFn: saveScoreOverrides, // API function to call
    onSuccess: (data) => {
      console.log("Overrides saved successfully:", data);
      setSaveStatus({ success: "Overrides saved successfully!", error: null });
      setOverrides({}); // Clear local override state after successful save

      // Invalidate queries to refetch data in the dashboard
      queryClient.invalidateQueries({ queryKey: ["adminScores"] });
      // Optionally invalidate details if you were fetching them separately
      // queryClient.invalidateQueries({ queryKey: ['submissionDetails', studentSubmission?.student, studentSubmission?.quiz_id] });

      // Optional: Close the detail view automatically after save
      setTimeout(onClose, 1500); // Close after 1.5 seconds
    },
    onError: (err: any) => {
      console.error("Failed to save overrides:", err);
      setSaveStatus({
        error: `Failed to save overrides: ${err.message}`,
        success: null,
      });
    },
  });

  // Handler for changes in the override input fields
  const handleOverrideChange = (
    questionId: string | number,
    pointsStr: string,
    maxPoints: number,
  ) => {
    const points = pointsStr === "" ? undefined : parseFloat(pointsStr);

    setOverrides((prev) => {
      const newOverrides = { ...prev };
      if (points === undefined || isNaN(points)) {
        delete newOverrides[questionId];
      } else {
        // Clamp the value between 0 and the question's weight (maxPoints)
        newOverrides[questionId] = Math.max(0, Math.min(points, maxPoints));
      }
      return newOverrides;
    });
    setSaveStatus({});
  };

  // Handler for the save button click
  const handleSaveChanges = () => {
    setSaveStatus({}); // Clear previous messages
    if (!studentSubmission || !adminPassword) {
      setSaveStatus({
        error: "Missing submission data or admin credentials.",
        success: null,
      });
      return;
    }

    // Format the overrides into the payload expected by the API
    const overridePayloadData = Object.entries(overrides).map(([qid, pts]) => ({
      // Ensure question_id format matches backend expectation (string or number)
      question_id:
        studentSubmission.answers.find((a) => String(a.question_id) === qid)
          ?.question_id ?? qid,
      points: pts, // Send the stored number
    }));

    if (overridePayloadData.length === 0) {
      setSaveStatus({ error: "No score changes to save.", success: null });
      return;
    }

    const payload: OverridePayload = {
      student_id: studentSubmission.student,
      quiz_id: studentSubmission.quiz_id,
      overrides: overridePayloadData,
      password: adminPassword, // Pass password for backend auth
    };

    saveMutation.mutate(payload); // Execute the mutation
  };

  // Render null if no submission is selected
  if (!studentSubmission) {
    return null;
  }

  // Determine if there are any pending changes
  const hasPendingOverrides = Object.keys(overrides).length > 0;

  return (
    // Container for the detail view with styling
    <div className="mt-8 p-6 border border-gray-300 rounded-lg shadow-lg bg-white space-y-4 relative">
      {/* Close Button */}
      <button
        onClick={onClose}
        className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 text-2xl font-bold"
        aria-label="Close details"
      >
        &times; {/* Multiplication sign as close icon */}
      </button>

      {/* Header */}
      <div className="border-b pb-2 mb-4">
        <h3 className="text-xl font-semibold text-gray-800">
          Reviewing: {studentSubmission.student}
        </h3>
        <p className="text-sm text-gray-500">
          Quiz ID: {studentSubmission.quiz_id}
        </p>
        <p className="text-sm text-gray-600 font-medium">
          Overall Score: {studentSubmission.raw_points} /{" "}
          {studentSubmission.max_points} ({studentSubmission.percent}%)
        </p>
      </div>

      {/* List of Answers */}
      <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-2">
        {studentSubmission.answers.map((ans, index) => {
          // Default weight to 1 if missing in the data (for older records)
          const questionWeight = ans.weight ?? 1;
          return (
            <div
              key={index}
              className="p-4 border rounded-md bg-gray-50 shadow-sm"
            >
              {/* Question Info */}
              <p className="font-semibold text-gray-800 mb-1">
                {index + 1}. {ans.question_text}
                <span className="text-xs text-gray-400 ml-2">
                  (ID: {ans.question_id})
                </span>
              </p>

              {/* Student Answer */}
              <div className="ml-4 mb-2 text-sm">
                <span className="font-medium text-gray-600">
                  Student Answer:{" "}
                </span>
                <pre className="inline-block font-mono bg-gray-100 p-1 rounded text-xs whitespace-pre-wrap break-words">
                  {JSON.stringify(ans.student_answer, null, 2)}
                </pre>
              </div>

              {/* Correct Answer */}
              <div className="ml-4 mb-2 text-sm">
                <span className="font-medium text-green-700">
                  Correct Answer:{" "}
                </span>
                <pre className="inline-block font-mono bg-green-50 p-1 rounded text-xs whitespace-pre-wrap break-words">
                  {JSON.stringify(ans.correct_answer, null, 2)}
                </pre>
              </div>

              {/* Points and Override Input */}
              <div
                className={`ml-4 mt-2 flex items-center gap-3 text-sm ${ans.points_awarded !== ans.raw_points && "text-red-500"}`}
              >
                <span className="font-medium">
                  Points Awarded:{" "}
                  <span className="font-bold">{ans.points_awarded}</span>
                </span>
                <span className="text-gray-400">|</span>
                <label
                  htmlFor={`override-${ans.question_id}`}
                  className="text-gray-600"
                >
                  Override Score:
                </label>
                <input
                  id={`override-${ans.question_id}`}
                  type="number"
                  min="0" // Minimum score is 0
                  max={questionWeight} // Maximum score is the question's weight
                  step="0.5" // Or "1" if only whole points
                  className="w-24 border border-gray-300 p-1 text-sm rounded shadow-sm focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder={ans.raw_points.toString()}
                  value={
                    overrides[ans.question_id] ?? ans.raw_points.toString()
                  }
                  // Pass max weight to handler for clamping
                  onChange={(e) =>
                    handleOverrideChange(
                      ans.question_id,
                      e.target.value,
                      questionWeight,
                    )
                  }
                />
                {/* Display max points for clarity */}
                <span className="text-xs text-gray-500">
                  (Max: {questionWeight})
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Save Button and Status Messages */}
      <div className="mt-6 flex justify-end items-center gap-4 border-t pt-4">
        {/* Display Success/Error Messages */}
        {saveStatus.error && <ErrorDisplay message={saveStatus.error} />}
        {saveStatus.success && (
          <div className="p-2 bg-green-50 border border-green-300 text-green-800 rounded-lg text-sm">
            {saveStatus.success}
          </div>
        )}

        <button
          onClick={handleSaveChanges}
          disabled={saveMutation.isPending || !hasPendingOverrides}
          className="px-5 py-2 bg-purple-600 text-white font-medium rounded-md shadow hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {saveMutation.isPending ? (
            <>
              <LoadingSpinner message="" /> {/* Minimal spinner */}
              Saving...
            </>
          ) : (
            "Save Score Overrides"
          )}
        </button>
      </div>
    </div>
  );
}

export default SubmissionDetailView;
