// frontend/src/pages/AdminStudentsBankPage.tsx
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import {
  listStudentsBankFiles,
  loadStudentsFromBank,
  saveStudentsToBank,
  previewStudentsBankFile,
  deleteStudentsFromBank,
  StudentEntry,
  getStudentsDownloadUrl,
  renameStudentsInBank, // New import for rename
  BankOperationResponse,
} from "../api";

function AdminStudentsBankPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const adminPassword = location.state?.adminPassword;

  const [saveFilename, setSaveFilename] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [previewingFile, setPreviewingFile] = useState<string | null>(null);
  const [deleteConfirmFile, setDeleteConfirmFile] = useState<string | null>(null);
  const [loadConfirmFile, setLoadConfirmFile] = useState<string | null>(null);
  const [renameTargetFile, setRenameTargetFile] = useState<string | null>(null); // Track which file is being renamed
  const [newFilename, setNewFilename] = useState(""); // State for the new filename input

  const queryClient = useQueryClient();

  // Generate default filename
  const defaultFilename = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}_${hours}-${minutes}_students.jsonc`;
  }, []);

  // Pre-fill the filename input when default changes
  useMemo(() => {
    if (defaultFilename) {
      setSaveFilename(defaultFilename);
    }
  }, [defaultFilename]);

  // Fetch list of files in the students_bank
  const {
    data: bankFilesData,
    isLoading: isLoadingFiles,
    error: filesError,
  } = useQuery<{ files: string[] }, Error>({
    queryKey: ["studentsBankFiles", adminPassword],
    queryFn: () => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      setMessage(null);
      setError(null);
      return listStudentsBankFiles(adminPassword);
    },
    enabled: !!adminPassword,
    staleTime: 10 * 1000,
  });

  // Load students from bank mutation
  const loadMutation = useMutation<
    { success: boolean; message: string },
    Error,
    string
  >({
    mutationFn: (filename: string) => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      return loadStudentsFromBank(filename, adminPassword);
    },
    onSuccess: (data, filename) => {
      setMessage(data.message || `Loaded '${filename}' successfully.`);
      setError(null);
      setPreviewingFile(null);
      setLoadConfirmFile(null);
      queryClient.invalidateQueries({ queryKey: ["adminStudents"] });
    },
    onError: (err) => {
      setError(`Load failed: ${err.message}`);
      setMessage(null);
      setLoadConfirmFile(null);
    },
  });

  // Save students to bank mutation
  const saveMutation = useMutation<
    { success: boolean; message: string },
    Error,
    string
  >({
    mutationFn: (filename: string) => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      return saveStudentsToBank(filename, adminPassword);
    },
    onSuccess: (data) => {
      setMessage(data.message || "Students saved to bank successfully.");
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["studentsBankFiles"] });
    },
    onError: (err) => {
      setError(`Save failed: ${err.message}`);
      setMessage(null);
    },
  });

  // Preview mutation
  const previewMutation = useMutation<
    { students: StudentEntry[]; filename: string },
    Error,
    string
  >({
    mutationFn: (filename: string) => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      return previewStudentsBankFile(filename, adminPassword);
    },
    onSuccess: () => {
      setError(null);
    },
    onError: (err) => {
      setError(`Preview failed: ${err.message}`);
      setPreviewingFile(null);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation<
    { success: boolean; message: string },
    Error,
    string
  >({
    mutationFn: (filename: string) => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      return deleteStudentsFromBank(filename, adminPassword);
    },
    onSuccess: (data) => {
      setMessage(data.message || "Students file deleted successfully.");
      setError(null);
      setDeleteConfirmFile(null);
      queryClient.invalidateQueries({ queryKey: ["studentsBankFiles"] });
    },
    onError: (err) => {
      setError(`Delete failed: ${err.message}`);
      setMessage(null);
      setDeleteConfirmFile(null);
    },
  });


  // Rename Mutation
  const renameMutation = useMutation<BankOperationResponse, Error, { filename: string; newFilename: string }>({
    mutationFn: ({ filename, newFilename }) => {
      if (!adminPassword) {
        throw new Error("Admin password not available.");
      }
      setError(null);
      setMessage(null);
      return renameStudentsInBank(filename, newFilename, adminPassword);
    },
    onSuccess: (data, variables) => {
      setRenameTargetFile(null);
      setNewFilename("");
      setMessage(data.message || `File '${variables.filename}' renamed successfully!`);
      queryClient.invalidateQueries({ queryKey: ["studentsBankFiles"] });
    },
    onError: (err: any) => {
      setError(`Failed to rename file: ${err.message}`);
    },
  });

  const handleRenameClick = (filename: string) => {
    setRenameTargetFile(filename);
    setNewFilename(filename); // Pre-fill with current filename
  };

  const submitRename = () => {
    if (!renameTargetFile || !newFilename.trim()) return;

    let finalName = newFilename.trim();
    if (!finalName.endsWith('.jsonc')) {
      finalName += '.jsonc';
    }

    if (finalName === renameTargetFile) {
      setRenameTargetFile(null); // No change
      return;
    }

    renameMutation.mutate({ filename: renameTargetFile, newFilename: finalName });
  };

  const handleLoad = (filename: string) => {
    setLoadConfirmFile(filename);
  };

  const handleLoadConfirm = (filename: string) => {
    loadMutation.mutate(filename);
  };

  const handleLoadCancel = () => {
    setLoadConfirmFile(null);
  };

  const handleSave = () => {
    if (!saveFilename.trim()) {
      setError("Please enter a filename.");
      return;
    }
    saveMutation.mutate(saveFilename);
  };

  const handlePreview = (filename: string) => {
    setPreviewingFile(filename);
    previewMutation.mutate(filename);
  };

  const handleClosePreview = () => {
    setPreviewingFile(null);
  };

  const handleDeleteClick = (filename: string) => {
    setDeleteConfirmFile(filename);
  };

  const handleDeleteConfirm = (filename: string) => {
    deleteMutation.mutate(filename);
  };

  const handleDeleteCancel = () => {
    setDeleteConfirmFile(null);
  };

  // Email validation helper
  const isValidEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Group students by group for preview
  const getGroupedStudents = (students: StudentEntry[]) => {
    const groups: Record<string, string[]> = {};

    students.forEach(student => {
      if (typeof student === 'string') {
        if (!groups["No Group"]) groups["No Group"] = [];
        groups["No Group"].push(student);
      } else if ('emails' in student) {
        if (!groups[student.group]) groups[student.group] = [];
        groups[student.group].push(...student.emails);
      } else if ('email' in student) {
        const group = student.group || "No Group";
        if (!groups[group]) groups[group] = [];
        groups[group].push(student.email);
      }
    });

    // Remove empty "No Group"
    if (groups["No Group"] && groups["No Group"].length === 0) {
      delete groups["No Group"];
    }

    return groups;
  };

  const previewData = previewMutation.data;
  const groupedPreview = previewData ? getGroupedStudents(previewData.students) : null;
  const totalEmails = groupedPreview
    ? Object.values(groupedPreview).reduce((sum, emails) => sum + emails.length, 0)
    : 0;
  const isLoading =
    isLoadingFiles ||
    loadMutation.isPending ||
    saveMutation.isPending ||
    deleteMutation.isPending ||
    renameMutation.isPending ||
    previewMutation.isPending;

  const currentError =
    error ||
    filesError ||
    loadMutation.error ||
    saveMutation.error ||
    deleteMutation.error ||
    renameMutation.error ||
    previewMutation.error;

  return (
    <div className="container mx-auto p-4">
      {/* Header */}
      <div className="flex justify-start items-center mb-4">
        <button
          onClick={() => {
            navigate("/admin/dashboard", {
              state: { adminPassword: adminPassword },
            });
          }}
          className="px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-gray-700"
        >
          Go to admin dashboard
        </button>
      </div>

      <h1 className="text-3xl font-bold mb-6">Students Bank Manager</h1>

      {/* Messages */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}
      {message && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
          {message}
        </div>
      )}

      {/* Save Section */}
      <div className="mb-8 p-4 border rounded bg-gray-50">
        <h2 className="text-2xl font-semibold mb-4">Save Current Students to Bank</h2>
        <div className="flex gap-2 items-start">
          <div className="flex-grow">
            <input
              type="text"
              value={saveFilename}
              onChange={(e) => setSaveFilename(e.target.value)}
              placeholder="Enter filename (e.g., 2025-10-25_students.jsonc)"
              className="w-full p-2 border rounded"
            />
            <p className="text-sm text-gray-600 mt-1">
              Default format: YYYY-MM-DD_HH-MM_students.jsonc
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="px-6 py-2 bg-green-500 text-white font-bold rounded hover:bg-green-700 disabled:opacity-50"
          >
            {saveMutation.isPending ? "Saving..." : "Save to Bank"}
          </button>
        </div>
      </div>

      {/* Load Section */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Available Students Files</h2>
        {isLoadingFiles && <p>Loading files...</p>}
        {currentError && (
          <p className="text-red-600">
            Error: {typeof currentError === 'string' ? currentError : currentError.message}
          </p>
        )}
        {bankFilesData && bankFilesData.files.length === 0 && (
          <p className="text-gray-600">No students files in bank yet.</p>
        )}
        {bankFilesData && bankFilesData.files.length > 0 && (
          <div className="space-y-2">
            {bankFilesData.files.map((file) => (
              <div
                key={file}
                className="flex items-center justify-between p-3 border rounded bg-white hover:bg-gray-50"
              >
                {renameTargetFile === file ? (
                  <div className="flex items-center gap-2 flex-grow mr-2">
                    <input
                      type="text"
                      value={newFilename}
                      onChange={(e) => setNewFilename(e.target.value)}
                      className="border p-1 text-sm flex-grow rounded"
                      autoFocus
                    />
                    <button
                      onClick={submitRename}
                      className="bg-green-500 text-white px-2 py-1 text-xs rounded"
                      disabled={renameMutation.isPending}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setRenameTargetFile(null)}
                      className="bg-gray-500 text-white px-2 py-1 text-xs rounded"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <span className="font-mono text-sm">{file}</span>
                )}

                <div className="flex gap-2">
                  {renameTargetFile !== file && (
                    <>
                      <button
                        onClick={() => handlePreview(file)}
                        disabled={previewMutation.isPending && previewingFile === file}
                        className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        {previewingFile === file ? "Previewing..." : "Preview"}
                      </button>

                      {loadConfirmFile === file ? (
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-red-600 font-bold">Overwrite current?</span>
                          <button
                            onClick={() => handleLoadConfirm(file)}
                            className="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-700"
                          >
                            Yes
                          </button>
                          <button
                            onClick={handleLoadCancel}
                            className="px-2 py-1 bg-gray-500 text-white text-xs rounded hover:bg-gray-700"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleLoad(file)}
                          disabled={isLoading}
                          className="px-3 py-1 bg-yellow-500 text-white text-sm rounded hover:bg-yellow-700 disabled:opacity-50"
                        >
                          Load
                        </button>
                      )}
                      <button
                        onClick={() => handleRenameClick(file)}
                        className="px-3 py-1 bg-indigo-500 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50"
                        disabled={isLoading}
                      >
                        Rename
                      </button>
                      <a
                        href={getStudentsDownloadUrl(file, adminPassword || "")}
                        className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50 inline-block"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Download
                      </a>
                      {/* Delete Button with Inline Confirmation */}
                      {deleteConfirmFile === file ? (
                        <span className="inline-flex items-center gap-1 bg-yellow-50 px-2 py-1 rounded border border-yellow-300 ml-2">
                          <span className="text-yellow-700 text-xs font-semibold">Delete?</span>
                          <button
                            onClick={() => handleDeleteConfirm(file)}
                            className="bg-red-600 text-white px-2 py-0.5 text-xs rounded hover:bg-red-700 disabled:opacity-50"
                            disabled={deleteMutation.isPending}
                          >
                            {deleteMutation.isPending ? "Deleting..." : "Yes"}
                          </button>
                          <button
                            onClick={handleDeleteCancel}
                            className="bg-gray-500 text-white px-2 py-0.5 text-xs rounded hover:bg-gray-600 disabled:opacity-50"
                            disabled={deleteMutation.isPending}
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => handleDeleteClick(file)}
                          className="px-3 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
                          disabled={isLoading} // Use global isLoading
                        >
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewingFile && previewData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="text-xl font-bold">Preview: {previewData.filename}</h3>
              <button
                onClick={handleClosePreview}
                className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
              >
                ×
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-grow">
              {groupedPreview && (
                <div className="space-y-4">
                  <div className="text-sm text-gray-600">
                    Total students: <strong>{totalEmails}</strong>
                  </div>
                  {Object.entries(groupedPreview).map(([group, emails]) => (
                    <div key={group} className="border rounded p-3">
                      <h4 className="font-semibold text-lg mb-2">{group}</h4>
                      <ul className="space-y-1">
                        {emails.map((email, idx) => (
                          <li key={idx} className="text-sm flex items-center gap-2">
                            <span className="text-gray-400">{idx + 1}.</span>
                            <span className={isValidEmail(email) ? "text-green-700" : "text-red-700"}>
                              {isValidEmail(email) ? "✓" : "✗"}
                            </span>
                            <span className={isValidEmail(email) ? "text-gray-900" : "text-red-600"}>
                              {email}
                              {!isValidEmail(email) && " ⚠️ Invalid email"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t flex justify-end gap-2">
              <button
                onClick={handleClosePreview}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-700"
              >
                Close
              </button>
              {loadConfirmFile === previewingFile ? (
                <span className="inline-flex items-center gap-2 bg-yellow-50 px-3 py-2 rounded border border-yellow-300">
                  <span className="text-sm text-gray-700">Load this file?</span>
                  <button
                    onClick={() => {
                      handleClosePreview();
                      handleLoadConfirm(previewingFile);
                    }}
                    className="bg-yellow-600 text-white px-3 py-1 text-sm rounded hover:bg-yellow-700"
                    disabled={loadMutation.isPending}
                  >
                    {loadMutation.isPending ? "Loading..." : "Yes"}
                  </button>
                  <button
                    onClick={handleLoadCancel}
                    className="bg-gray-500 text-white px-3 py-1 text-sm rounded hover:bg-gray-600"
                    disabled={loadMutation.isPending}
                  >
                    No
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => handleLoad(previewingFile)}
                  className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-700"
                >
                  Load This File
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminStudentsBankPage;
