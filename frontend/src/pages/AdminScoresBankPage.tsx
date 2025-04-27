// frontend/src/pages/AdminScoresBankPage.tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import {
  fetchScoresBankFiles,
  loadScoresFromBank,
  saveScoresToBank,
  fetchPreviewScoresBankFile,
  BankOperationResponse,
  ScoresBankFilesResponse,
  ScoreEntry, // Import the ScoreEntry type for preview content
} from "../api"; // Assuming api.ts is in src/

// Define the name of the scores bank folder for display purposes
const SCORES_BANK_FOLDER = "scores_bank"; // Or import if defined elsewhere

function AdminScoresBankPage() {
  // RETRIEVE PASSWORD USING useLocation STATE AS PER YOUR CODE'S PATTERN (NOTE: INSECURE)
  const location = useLocation();
  const navigate = useNavigate();

  const adminPassword = location.state?.adminPassword;

  const [saveSuffix, setSaveSuffix] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [previewingFile, setPreviewingFile] = useState<string | null>(null); // State to track which file is being previewed

  const queryClient = useQueryClient(); // Get Query Client instance

  // --- Fetch list of files in the scores_bank using React Query ---
  const {
    data: bankFilesData,
    isLoading: isLoadingFiles,
    error: filesError,
  } = useQuery<ScoresBankFilesResponse, Error>({
    // Specify types for data and error
    queryKey: ["scoresBankFiles", adminPassword], // Query key, include password
    queryFn: () => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      setMessage(null); // Clear messages on new fetch attempt
      setError(null); // Clear previous errors
      return fetchScoresBankFiles(adminPassword); // Call your API function
    },
    enabled: !!adminPassword, // Only run this query if adminPassword exists
  });

  // --- Mutation for Loading a file from the scores bank ---
  const loadFileMutation = useMutation<BankOperationResponse, Error, string>({
    // Specify types: result, error, variables (filename)
    mutationFn: (filename: string) => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      setError(null);
      setMessage(null);
      setPreviewingFile(null); // Close preview when loading
      return loadScoresFromBank(filename, adminPassword); // Call your API function
    },
    onSuccess: (data) => {
      setMessage(data.message || "Scores file loaded successfully!");
      // Invalidate or refetch queries that depend on the active scores if needed (e.g., AdminScoresPage)
      queryClient.invalidateQueries({ queryKey: ["scores", adminPassword] });
    },
    onError: (err: any) => {
      setError(`Failed to load scores file: ${err.message}`);
    },
    onSettled: () => {
      // Optional: Refetch file list if needed
      // refetchFiles(); // Not strictly needed for load, as bank contents don't change
    },
  });

  // --- Mutation for Saving the current scores file to the bank ---
  const saveFileMutation = useMutation<BankOperationResponse, Error, string>({
    // Specify types: result, error, variables (suffix)
    mutationFn: (filename_suffix: string) => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      setError(null);
      setMessage(null);
      return saveScoresToBank(filename_suffix, adminPassword); // Call your API function
    },
    onSuccess: (data) => {
      setMessage(data.message || "Scores file saved successfully!");
      setSaveSuffix(""); // Clear input on success
      // Refetch the list of scores bank files after saving
      queryClient.invalidateQueries({ queryKey: ["scoresBankFiles"] }); // Invalidate to refetch
    },
    onError: (err: any) => {
      setError(`Failed to save scores file: ${err.message}`);
    },
  });

  // --- Query for Previewing a file from the scores bank (triggered on demand) ---
  const {
    data: previewData,
    isLoading: isLoadingPreview,
    error: previewError,
    // refetch: fetchPreview // No manual refetch needed, enabled handles it
  } = useQuery<ScoreEntry[], Error>({
    // Expecting an array of ScoreEntry objects
    queryKey: ["scoresBankFilePreview", previewingFile, adminPassword], // Key includes filename and password
    queryFn: () => {
      if (!previewingFile || !adminPassword) {
        // This query should only run when previewingFile and password exist
        throw new Error("Preview file or password not available.");
      }
      // Clear previous preview errors/messages when starting a new preview
      setError(null);
      setMessage(null);
      return fetchPreviewScoresBankFile(previewingFile, adminPassword); // Call the new API function
    },
    enabled: !!previewingFile && !!adminPassword, // Only enabled when a file is selected for preview AND password is available
    staleTime: Infinity, // Preview data doesn't need to refetch automatically
  });

  // --- Handlers for user interactions ---
  const handleLoadClick = (filename: string) => {
    // Trigger the load mutation
    loadFileMutation.mutate(filename);
  };

  const handleSaveClick = () => {
    if (!saveSuffix.trim()) {
      setError("Please provide a filename suffix to save.");
      return;
    }
    // Trigger the save mutation
    saveFileMutation.mutate(saveSuffix.trim());
  };

  const handlePreviewClick = (filename: string) => {
    // Toggle previewing the selected file
    if (previewingFile === filename) {
      setPreviewingFile(null); // Hide preview if already showing for this file
      setError(null); // Clear any preview errors
      setMessage(null); // Clear messages
    } else {
      setPreviewingFile(filename); // Set the file to preview, which enables the preview query
      // The query will automatically run because `enabled` becomes true
    }
  };

  // --- Determine loading/error states combined ---
  const isLoading =
    isLoadingFiles ||
    loadFileMutation.isPending ||
    saveFileMutation.isPending ||
    isLoadingPreview;
  const currentError =
    error ||
    filesError ||
    loadFileMutation.error ||
    saveFileMutation.error ||
    previewError;

  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-start items-center mb-2">
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
      <h1 className="text-2xl font-bold mb-4">Scores Bank File Management</h1>

      {/* Message if password is not available */}
      {!adminPassword && (
        <div className="text-red-500 mb-4">
          Admin password not provided via navigation state. Please log in via
          the admin login page.
        </div>
      )}

      {/* Display any errors */}
      {currentError && (
        <div className="text-red-500 mb-4">
          Error:{" "}
          {typeof currentError === "string"
            ? currentError
            : currentError.message || "An unknown error occurred."}
        </div>
      )}
      {/* Display any success messages */}
      {message && <div className="text-green-500 mb-4">{message}</div>}

      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">
          Save Current Scores to Bank
        </h2>
        <div className="flex items-center">
          {/* Display date format example for user guidance */}
          <span className="mr-2 text-sm text-gray-600">
            {new Date().toLocaleDateString("sv").replace(/-/g, "")}
            _[suffix].jsonc
          </span>
          <input
            type="text"
            placeholder="Enter suffix"
            className="border p-2 mr-2 flex-grow"
            value={saveSuffix}
            onChange={(e) => setSaveSuffix(e.target.value)}
            disabled={isLoading || !adminPassword} // Disable if loading or no password
          />
          <button
            onClick={handleSaveClick}
            className="bg-green-500 text-white p-2 rounded disabled:bg-gray-400"
            disabled={isLoading || !adminPassword || !saveSuffix.trim()} // Disable if loading, no password, or empty suffix
          >
            {saveFileMutation.isPending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-2">
          Available Scores Files in Bank
        </h2>
        {isLoadingFiles ? (
          <p>Loading available files...</p>
        ) : bankFilesData?.files && bankFilesData.files.length > 0 ? (
          <ul>
            {bankFilesData.files.map((filename) => (
              <li key={filename} className="border-b mb-2 pb-2">
                <div className="flex justify-between items-center mb-2">
                  <span>{filename}</span>
                  <div>
                    <button
                      onClick={() => handlePreviewClick(filename)}
                      className="bg-blue-500 text-white p-1 text-sm rounded mr-2 disabled:bg-gray-400"
                      disabled={
                        isLoadingFiles || isLoadingPreview || !adminPassword
                      }
                    >
                      {previewingFile === filename && isLoadingPreview
                        ? "Loading Preview..."
                        : previewingFile === filename
                          ? "Hide Preview"
                          : "Preview"}
                    </button>
                    <button
                      onClick={() => handleLoadClick(filename)}
                      className="bg-yellow-500 text-white p-1 text-sm rounded disabled:bg-gray-400"
                      disabled={isLoading || !adminPassword}
                    >
                      {loadFileMutation.isPending &&
                      loadFileMutation.variables === filename
                        ? "Loading..."
                        : "Load"}
                    </button>
                  </div>
                </div>
                {/* --- Preview Area --- */}
                {previewingFile === filename &&
                  !isLoadingPreview &&
                  previewData && (
                    <div className="bg-gray-100 p-3 rounded text-sm max-h-60 overflow-y-auto">
                      <h3 className="font-semibold mb-2">Preview:</h3>
                      {/* Basic rendering of scores for preview */}
                      {previewData.length > 0 ? (
                        <pre>{JSON.stringify(previewData, null, 2)}</pre> // Display raw JSON for scores preview
                      ) : (
                        <p>No score entries found in this file.</p>
                      )}
                    </div>
                  )}
                {/* Show preview loading/error states */}
                {previewingFile === filename && isLoadingPreview && (
                  <p>Loading preview...</p>
                )}
                {previewingFile === filename &&
                  previewError &&
                  !isLoadingPreview && (
                    <div className="text-red-500 mt-2">
                      Error loading preview: {previewError.message}
                    </div>
                  )}
              </li>
            ))}
          </ul>
        ) : (
          !isLoadingFiles &&
          !currentError && (
            <p>
              No scores files found in the '{SCORES_BANK_FOLDER}' directory.
            </p>
          ) // Use SCORES_BANK_FOLDER constant
        )}
      </div>
    </div>
  );
}

export default AdminScoresBankPage;
