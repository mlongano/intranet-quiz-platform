// frontend/src/pages/AdminStudentsBankPage.tsx
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import {
  listStudentsBankFiles,
  loadStudentsFromBank,
  saveStudentsToBank,
  previewStudentsBankFile,
  deleteStudentsFromBank,
  StudentEntry,
  getStudentsDownloadUrl,
  renameStudentsInBank,
  BankOperationResponse,
} from "../api";
import AdminLayout from "../layouts/AdminLayout";

function AdminStudentsBankPage() {
  const location = useLocation();
  const adminPassword = location.state?.adminPassword;

  const [saveFilename, setSaveFilename] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [previewingFile, setPreviewingFile] = useState<string | null>(null);
  const [deleteConfirmFile, setDeleteConfirmFile] = useState<string | null>(null);
  const [loadConfirmFile, setLoadConfirmFile] = useState<string | null>(null);
  const [renameTargetFile, setRenameTargetFile] = useState<string | null>(null);
  const [newFilename, setNewFilename] = useState("");

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
    setNewFilename(filename);
  };

  const submitRename = () => {
    if (!renameTargetFile || !newFilename.trim()) return;

    let finalName = newFilename.trim();
    if (!finalName.endsWith('.jsonc')) {
      finalName += '.jsonc';
    }

    if (finalName === renameTargetFile) {
      setRenameTargetFile(null);
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
    <AdminLayout
      activePath="/admin/students-bank"
      adminPassword={adminPassword || ""}
      pageTitle="Students Bank"
    >
      {/* Messages */}
      {error && (
        <div className="mb-4 p-4 bg-error/10 border border-error/30 text-error rounded-lg text-sm">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-4 p-4 bg-tertiary/10 border border-tertiary/30 text-tertiary rounded-lg text-sm">
          {message}
        </div>
      )}

      {/* Save Section */}
      <div className="mb-8 p-6 bg-surface-container border border-outline-variant/20 rounded-xl">
        <h2 className="text-lg font-bold font-headline text-on-surface mb-4">Save Current Students to Bank</h2>
        <div className="flex gap-3 items-start">
          <div className="flex-grow">
            <input
              type="text"
              value={saveFilename}
              onChange={(e) => setSaveFilename(e.target.value)}
              placeholder="Enter filename (e.g., 2025-10-25_students.jsonc)"
              className="w-full p-3 bg-surface-container-low border border-outline-variant/30 text-on-surface rounded-lg focus:border-primary/50 focus:outline-none placeholder:text-outline-variant/50"
            />
            <p className="text-sm text-on-surface-variant mt-2">
              Default format: YYYY-MM-DD_HH-MM_students.jsonc
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="px-6 py-3 bg-tertiary text-on-tertiary font-bold rounded-lg hover:bg-tertiary/90 transition-all disabled:opacity-50"
          >
            {saveMutation.isPending ? "Saving..." : "Save to Bank"}
          </button>
        </div>
      </div>

      {/* Load Section */}
      <div className="mb-8">
        <h2 className="text-lg font-bold font-headline text-on-surface mb-4">Available Students Files</h2>
        {isLoadingFiles && <p className="text-on-surface-variant">Loading files...</p>}
        {currentError && (
          <p className="text-error text-sm">
            Error: {typeof currentError === 'string' ? currentError : currentError.message}
          </p>
        )}
        {bankFilesData && bankFilesData.files.length === 0 && (
          <p className="text-on-surface-variant">No students files in bank yet.</p>
        )}
        {bankFilesData && bankFilesData.files.length > 0 && (
          <div className="space-y-2">
            {bankFilesData.files.map((file) => (
              <div
                key={file}
                className="flex items-center justify-between p-4 bg-surface-container hover:bg-surface-container-high border-b border-outline-variant/10 rounded-lg"
              >
                {renameTargetFile === file ? (
                  <div className="flex items-center gap-2 flex-grow mr-3">
                    <input
                      type="text"
                      value={newFilename}
                      onChange={(e) => setNewFilename(e.target.value)}
                      className="bg-surface-container-low border border-outline-variant/30 text-on-surface focus:border-primary/50 focus:outline-none rounded px-2 py-1 text-sm flex-grow"
                      autoFocus
                    />
                    <button
                      onClick={submitRename}
                      className="bg-tertiary text-on-tertiary px-2 py-1 text-xs font-bold rounded hover:bg-tertiary/90 transition-all disabled:opacity-50"
                      disabled={renameMutation.isPending}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setRenameTargetFile(null)}
                      className="bg-surface-bright text-on-surface px-2 py-1 text-xs rounded hover:bg-surface-bright/80 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <span className="font-mono text-sm text-on-surface-variant">{file}</span>
                )}

                <div className="flex gap-2">
                  {renameTargetFile !== file && (
                    <>
                      <button
                        onClick={() => handlePreview(file)}
                        disabled={previewMutation.isPending && previewingFile === file}
                        className="bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-on-surface py-1 px-3 rounded text-sm transition-all disabled:opacity-50"
                      >
                        {previewingFile === file ? "Previewing..." : "Preview"}
                      </button>

                      {loadConfirmFile === file ? (
                        <div className="flex gap-2 items-center bg-surface-container-high border border-outline-variant/30 rounded-lg px-2 py-1 text-sm">
                          <span className="text-on-surface font-bold">Overwrite current?</span>
                          <button
                            onClick={() => handleLoadConfirm(file)}
                            className="bg-error/20 border border-error/30 text-error hover:bg-error/30 px-2 py-0.5 text-xs rounded transition-all"
                          >
                            Yes
                          </button>
                          <button
                            onClick={handleLoadCancel}
                            className="bg-surface-bright text-on-surface px-2 py-0.5 text-xs rounded hover:bg-surface-bright/80 transition-all"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleLoad(file)}
                          disabled={isLoading}
                          className="bg-primary text-on-primary font-bold py-1 px-3 rounded transition-all text-sm disabled:opacity-50"
                        >
                          Load
                        </button>
                      )}
                      <button
                        onClick={() => handleRenameClick(file)}
                        className="bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-on-surface py-1 px-3 rounded text-sm transition-all disabled:opacity-50"
                        disabled={isLoading}
                      >
                        Rename
                      </button>
                      <a
                        href={getStudentsDownloadUrl(file, adminPassword || "")}
                        className="bg-tertiary/10 border border-tertiary/30 text-tertiary hover:bg-tertiary/20 py-1 px-3 rounded text-sm transition-all inline-block"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Download
                      </a>
                      {deleteConfirmFile === file ? (
                        <div className="flex gap-2 items-center bg-error/10 px-2 py-1 rounded border border-error/30 text-sm">
                          <span className="text-error font-semibold">Delete?</span>
                          <button
                            onClick={() => handleDeleteConfirm(file)}
                            className="bg-error/20 border border-error/30 text-error hover:bg-error/30 px-2 py-0.5 text-xs rounded transition-all disabled:opacity-50"
                            disabled={deleteMutation.isPending}
                          >
                            {deleteMutation.isPending ? "Deleting..." : "Yes"}
                          </button>
                          <button
                            onClick={handleDeleteCancel}
                            className="bg-surface-bright text-on-surface px-2 py-0.5 text-xs rounded hover:bg-surface-bright/80 transition-all disabled:opacity-50"
                            disabled={deleteMutation.isPending}
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleDeleteClick(file)}
                          className="bg-error/10 border border-error/30 text-error hover:bg-error/20 py-1 px-3 rounded text-sm transition-all disabled:opacity-50"
                          disabled={isLoading}
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
        <div className="fixed inset-0 z-50 backdrop-blur-sm bg-black/60 flex items-center justify-center p-4">
          <div className="bg-surface-container border border-outline-variant/20 rounded-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="p-4 border-b border-outline-variant/20 flex justify-between items-center">
              <h3 className="text-lg font-bold font-headline text-on-surface">Preview: {previewData.filename}</h3>
              <button
                onClick={handleClosePreview}
                className="text-on-surface-variant hover:text-on-surface text-2xl font-bold leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-grow">
              {groupedPreview && (
                <div className="space-y-4">
                  <div className="text-sm text-on-surface-variant">
                    Total students: <strong className="text-on-surface">{totalEmails}</strong>
                  </div>
                  {Object.entries(groupedPreview).map(([group, emails]) => (
                    <div key={group} className="border border-outline-variant/20 rounded-lg p-3">
                      <h4 className="text-primary font-bold text-sm mb-2">{group}</h4>
                      <ul className="space-y-1">
                        {emails.map((email, idx) => (
                          <li key={idx} className="text-sm flex items-center gap-2">
                            <span className="text-outline-variant">{idx + 1}.</span>
                            <span className={isValidEmail(email) ? "text-tertiary" : "text-error"}>
                              {isValidEmail(email) ? "✓" : "✗"}
                            </span>
                            <span className={isValidEmail(email) ? "text-on-surface-variant" : "text-error"}>
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
            <div className="p-4 border-t border-outline-variant/20 flex justify-end gap-2">
              <button
                onClick={handleClosePreview}
                className="px-4 py-2 bg-surface-bright text-on-surface rounded-lg hover:bg-surface-bright/80 transition-all"
              >
                Close
              </button>
              {loadConfirmFile === previewingFile ? (
                <div className="flex gap-2 items-center bg-surface-container-high border border-outline-variant/30 rounded-lg px-3 py-2">
                  <span className="text-sm text-on-surface-variant">Load this file?</span>
                  <button
                    onClick={() => {
                      handleClosePreview();
                      handleLoadConfirm(previewingFile);
                    }}
                    className="bg-primary text-on-primary px-3 py-1 text-sm font-bold rounded hover:bg-primary/90 transition-all disabled:opacity-50"
                    disabled={loadMutation.isPending}
                  >
                    {loadMutation.isPending ? "Loading..." : "Yes"}
                  </button>
                  <button
                    onClick={handleLoadCancel}
                    className="bg-surface-bright text-on-surface px-3 py-1 text-sm rounded hover:bg-surface-bright/80 transition-all disabled:opacity-50"
                    disabled={loadMutation.isPending}
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleLoad(previewingFile)}
                  className="px-4 py-2 bg-primary text-on-primary font-bold rounded-lg hover:bg-primary/90 transition-all"
                >
                  Load This File
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

export default AdminStudentsBankPage;