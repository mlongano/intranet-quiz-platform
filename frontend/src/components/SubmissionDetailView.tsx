// frontend/src/components/SubmissionDetailView.tsx
import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ScoreEntry, saveScoreOverrides, OverridePayload, saveBankScoreOverrides, BankOverridePayload } from "../api";
import LoadingSpinner from "./LoadingSpinner";
import ErrorDisplay from "./ErrorDisplay";

interface Props {
  studentSubmission: ScoreEntry | null;
  adminPassword: string;
  onClose: () => void;
  bankFilename?: string;
  onSubmissionUpdated?: (updatedSubmission: ScoreEntry) => void;
}

function SubmissionDetailView({
  studentSubmission,
  adminPassword,
  onClose,
  bankFilename,
  onSubmissionUpdated,
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

  useEffect(() => {
    setOverrides({});
    setSaveStatus({});
  }, [studentSubmission]);

  const saveMutation = useMutation({
    mutationFn: saveScoreOverrides,
    onSuccess: () => {
      setSaveStatus({ success: "Overrides saved successfully!", error: null });
      setOverrides({});
      queryClient.invalidateQueries({ queryKey: ["adminScores"] });
      setTimeout(onClose, 1500);
    },
    onError: (err: any) => {
      setSaveStatus({
        error: `Failed to save overrides: ${err.message}`,
        success: null,
      });
    },
  });

  const saveBankMutation = useMutation({
    mutationFn: saveBankScoreOverrides,
    onSuccess: (data) => {
      setSaveStatus({ success: "Bank scores updated successfully!", error: null });
      setOverrides({});
      queryClient.invalidateQueries({ queryKey: ["scoresBankPreview", bankFilename] });
      if (onSubmissionUpdated && data.updated_submission) {
        onSubmissionUpdated(data.updated_submission);
      }
      setTimeout(onClose, 1500);
    },
    onError: (err: any) => {
      setSaveStatus({
        error: `Failed to save bank overrides: ${err.message}`,
        success: null,
      });
    },
  });

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

    if (bankFilename) {
      const bankPayload: BankOverridePayload = {
        filename: bankFilename,
        student_id: studentSubmission.student,
        quiz_id: studentSubmission.quiz_id,
        overrides: overridePayloadData,
        password: adminPassword,
      };
      saveBankMutation.mutate(bankPayload);
    } else {
      const payload: OverridePayload = {
        student_id: studentSubmission.student,
        quiz_id: studentSubmission.quiz_id,
        overrides: overridePayloadData,
        password: adminPassword,
      };
      saveMutation.mutate(payload);
    }
  };

  if (!studentSubmission) {
    return null;
  }

  const hasPendingOverrides = Object.keys(overrides).length > 0;
  const isSaving = saveMutation.isPending || saveBankMutation.isPending;

  function displayOptionImages(images: any, answers: any) {
    // Implement logic to display option images
    return (
      <div>
        {Array.isArray(images)
          ? images.map(
            (image, index) =>
              image && (
                <img
                  key={index}
                  src={image}
                  alt={`${answers[index]}`}
                  className="w-40 max-w-10 mx-auto my-2"
                />
              ),
          )
          : images && (
            <img
              src={images}
              alt={`${answers}`}
              className="w-40 max-w-10 mx-auto my-2"
            />
          )}
      </div>
    );
  }

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
              <div className="font-semibold text-gray-800 mb-1">
                <span className="mr-1">{index + 1}.</span>
                <span className="align-middle">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeSanitize]}
                  >
                    {ans.question_text || ""}
                  </ReactMarkdown>
                </span>
                <span className="text-xs text-gray-400 ml-2 align-middle">
                  (ID: {ans.question_id})
                </span>
              </div>
              {ans.question_image && (
                <img
                  src={ans.question_image}
                  alt={`Question ${index + 1} Image`}
                  className="w-40 max-w-sm mx-auto my-2"
                />
              )}

              {/* Student Answer */}
              <div className="flex justify-start items-center gap-2 ml-4 mb-2 text-sm">
                <span className="font-medium text-gray-600">
                  Student Answer:{" "}
                </span>
                <pre className="inline-block font-mono bg-gray-100 p-1 rounded text-xs whitespace-pre-wrap break-words">
                  {JSON.stringify(ans.student_answer, null, 2)}
                </pre>
                {displayOptionImages(
                  ans.option_student_image,
                  ans.student_answer,
                )}
                {ans.points_awarded === ans.weight && (
                  <span className="font-bold text-xl text-green-700">✓</span>
                )}
                {ans.points_awarded > 0 && ans.points_awarded < ans.weight && (
                  <span className="font-bold text-xl text-yellow-400">⚠</span>
                )}
                {ans.points_awarded === 0 && (
                  <span className="font-bold text-xl text-red-700">❌</span>
                )}
              </div>

              {/* Correct Answer */}
              <div className="flex justify-start items-center gap-2 ml-4 mb-2 text-sm">
                <span className="font-medium text-green-700">
                  Correct Answer:{" "}
                </span>
                <pre className="inline-block font-mono bg-green-50 p-1 rounded text-xs whitespace-pre-wrap break-words">
                  {JSON.stringify(ans.correct_answer, null, 2)}
                </pre>
                {displayOptionImages(
                  ans.option_correct_image,
                  ans.correct_answer,
                )}
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

              {/* LLM Verdict and Feedback (teacher-only) */}
              {(ans.llm_verdict || ans.llm_feedback) && (
                <div className="ml-4 mt-2 bg-yellow-50 border border-yellow-200 p-3 rounded text-sm">
                  <div className="font-semibold text-sm text-yellow-800 mb-1">LLM Evaluation</div>
                  {ans.llm_verdict && (
                    <div className="text-xs text-yellow-900 mb-1">
                      <strong>Verdict:</strong> {String(ans.llm_verdict)}
                    </div>
                  )}
                  {ans.llm_feedback && (
                    <div className="text-xs text-yellow-900">
                      <strong>Feedback:</strong> {String(ans.llm_feedback)}
                    </div>
                  )}
                </div>
              )}
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
          disabled={isSaving || !hasPendingOverrides}
          className="px-5 py-2 bg-purple-600 text-white font-medium rounded-md shadow hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSaving ? (
            <>
              <LoadingSpinner message="" />
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
