// frontend/src/pages/AdminStudentsPage.tsx

import { useState, useEffect, useCallback, useMemo } from "react";
import { parse, ParseError } from "jsonc-parser";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchStudents, updateStudents, StudentEntry } from "../api";
import { useLocation } from "react-router-dom";
import AdminLayout from "../layouts/AdminLayout";

const AdminStudentsPage = () => {
  const location = useLocation();
  const adminPassword = location.state?.adminPassword;

  const [studentsJson, setStudentsJson] = useState<string>("");
  const [userMessage, setUserMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [isFormatGuideOpen, setIsFormatGuideOpen] = useState(false);

  const queryClient = useQueryClient();

  // Fetch students using useQuery
  const {
    data: studentsData,
    isLoading: isLoadingStudents,
    isError: isLoadError,
    error: loadError,
    refetch: refetchStudents,
    isFetching: isFetchingStudents,
  } = useQuery<StudentEntry[], Error>({
    queryKey: ["adminStudents", adminPassword],
    queryFn: () => {
      if (!adminPassword) {
        return Promise.reject(new Error("Password not available"));
      }
      return fetchStudents(adminPassword);
    },
    enabled: !!adminPassword,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Effect to update the local JSON state when query data changes
  useEffect(() => {
    if (studentsData) {
      setStudentsJson(JSON.stringify(studentsData, null, 2));
      setUserMessage({
        type: "success",
        text: "Students loaded successfully",
      });
      setTimeout(() => setUserMessage(null), 2000);
    } else if (!isLoadingStudents && adminPassword) {
      setStudentsJson(JSON.stringify([], null, 2));
    }
  }, [studentsData, isLoadingStudents, adminPassword]);

  // Update students using useMutation
  const {
    mutate: saveStudentsMutation,
    isPending: isSaving,
    isError: isSaveError,
    error: saveError,
  } = useMutation<
    { success: boolean; message: string },
    Error,
    StudentEntry[]
  >({
    mutationFn: (updatedStudents: StudentEntry[]) => {
      if (!adminPassword) {
        return Promise.reject(new Error("Password not available for saving"));
      }
      return updateStudents(updatedStudents, adminPassword);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["adminStudents"] });
      setUserMessage({
        type: "success",
        text: data.message || "Students saved successfully!",
      });
      setTimeout(() => setUserMessage(null), 2000);
    },
    onError: (err) => {
      setUserMessage({ type: "error", text: `Save failed: ${err.message}` });
    },
  });

  // Email validation helper
  const isValidEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Save handler
  const handleSaveChanges = useCallback(() => {
    if (!studentsJson.trim()) {
      setUserMessage({ type: "error", text: "Cannot save empty content." });
      return;
    }

    let parsedData: StudentEntry[];
    try {
      const errors: ParseError[] = [];
      parsedData = parse(studentsJson, errors, {
        allowTrailingComma: true,
        disallowComments: false,
      });

      if (errors.length > 0) {
        setUserMessage({
          type: "error",
          text: `Invalid JSON format: ${JSON.stringify(errors, null, 2)}`,
        });
        return;
      }

      // Validate format
      if (!Array.isArray(parsedData)) {
        throw new Error("Students data must be an array.");
      }

      // Validate each student entry
      parsedData.forEach((student, idx) => {
        if (typeof student === 'string') {
          if (!isValidEmail(student)) {
            throw new Error(`Invalid email format at index ${idx}: ${student}`);
          }
        } else if (typeof student === 'object' && student !== null) {
          // Check if it's a group entry with emails array
          if ('emails' in student) {
            if (!('group' in student)) {
              throw new Error(`Missing 'group' field for emails array at index ${idx}.`);
            }
            if (typeof student.group !== 'string') {
              throw new Error(`Group must be a string at index ${idx}.`);
            }
            if (!Array.isArray(student.emails)) {
              throw new Error(`Emails must be an array at index ${idx}.`);
            }
            // Validate each email in the array
            student.emails.forEach((email: string, emailIdx: number) => {
              if (typeof email !== 'string') {
                throw new Error(`Email at index ${idx}, position ${emailIdx} must be a string.`);
              }
              if (!isValidEmail(email)) {
                throw new Error(`Invalid email format at index ${idx}, position ${emailIdx}: ${email}`);
              }
            });
          } else if ('email' in student) {
            // Single student format
            if (!isValidEmail(student.email)) {
              throw new Error(`Invalid email format at index ${idx}: ${student.email}`);
            }
            if ('group' in student && typeof student.group !== 'string') {
              throw new Error(`Group must be a string at index ${idx}.`);
            }
          } else {
            throw new Error(`Invalid student entry at index ${idx}. Must have 'email' or 'emails' field.`);
          }
        } else {
          throw new Error(`Invalid student entry at index ${idx}.`);
        }
      });

    } catch (parseError: any) {
      setUserMessage({
        type: "error",
        text: `Validation error: ${parseError.message}`,
      });
      return;
    }

    setUserMessage(null);
    saveStudentsMutation(parsedData);
  }, [studentsJson, saveStudentsMutation]);

  // Keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        handleSaveChanges();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleSaveChanges]);

  // Preview parsing
  const previewParsed = useMemo(() => {
    try {
      const errors: ParseError[] = [];
      const parsed = parse(studentsJson || '[]', errors, {
        allowTrailingComma: true,
        disallowComments: false,
      }) as StudentEntry[];

      if (errors.length > 0) {
        return {
          error: `Cannot preview: Invalid JSONC (${errors.length} issue${errors.length > 1 ? "s" : ""}).`,
          students: null as StudentEntry[] | null,
        };
      }

      if (!Array.isArray(parsed)) {
        return { error: "Cannot preview: Data must be an array.", students: null };
      }

      return { error: null as string | null, students: parsed };
    } catch (e: any) {
      return { error: `Cannot preview: ${e?.message || String(e)}`, students: null as StudentEntry[] | null };
    }
  }, [studentsJson]);

  // Group students by group for preview - flatten the emails arrays
  const groupedStudents = useMemo(() => {
    if (!previewParsed.students) return {};

    const groups: Record<string, string[]> = { "No Group": [] };

    previewParsed.students.forEach(student => {
      if (typeof student === 'string') {
        groups["No Group"].push(student);
      } else if ('emails' in student) {
        // Group with multiple emails
        const group = student.group;
        if (!groups[group]) {
          groups[group] = [];
        }
        groups[group].push(...student.emails);
      } else if ('email' in student) {
        // Single student with optional group
        const group = student.group || "No Group";
        if (!groups[group]) {
          groups[group] = [];
        }
        groups[group].push(student.email);
      }
    });

    // Remove "No Group" if it's empty
    if (groups["No Group"] && groups["No Group"].length === 0) {
      delete groups["No Group"];
    }

    return groups;
  }, [previewParsed.students]);

  // Calculate total number of emails (not entries)
  const totalEmails = useMemo(() => {
    return Object.values(groupedStudents).reduce((sum, emails) => sum + emails.length, 0);
  }, [groupedStudents]);

  const isProcessing = isLoadingStudents || isSaving || isFetchingStudents;

  if (adminPassword === null && !userMessage) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-on-surface-variant font-body">Loading editor...</div>
      </div>
    );
  }

  if (userMessage?.type === "error" && adminPassword === null) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-8">
        <div className="bg-error/10 border border-error/20 text-error px-4 py-3 rounded-lg font-body font-bold">
          {userMessage.text}
        </div>
      </div>
    );
  }

  if (isLoadingStudents && !studentsData) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-on-surface-variant font-body">Loading students...</div>
      </div>
    );
  }

  return (
    <AdminLayout
      activePath="/admin/students"
      adminPassword={adminPassword || ""}
      pageTitle="Students"
    >
      <div className="max-w-5xl">
        {/* Error/Success Messages */}
        {isLoadError && (
          <div
            className="bg-error/10 border border-error/20 text-error px-4 py-3 rounded-lg mb-4 font-body"
            role="alert"
          >
            Load failed: {loadError?.message || "Unknown error"}
          </div>
        )}
        {isSaveError && !isSaving && (
          <div
            className="bg-error/10 border border-error/20 text-error px-4 py-3 rounded-lg mb-4 font-body"
            role="alert"
          >
            Save failed: {saveError?.message || "Unknown error"}
          </div>
        )}
        {userMessage && (
          <div
            className={`border px-4 py-3 rounded-lg mb-4 font-body ${
              userMessage.type === "success"
                ? "bg-tertiary/10 border-tertiary/20 text-tertiary"
                : "bg-error/10 border-error/20 text-error"
            }`}
            role="alert"
          >
            {userMessage.text}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-4 mb-6">
          <button
            onClick={() => refetchStudents()}
            disabled={isProcessing || !adminPassword}
            className="bg-surface-container-high border border-primary/30 text-primary hover:bg-primary/10 font-bold py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-body"
          >
            {isFetchingStudents ? "Refreshing..." : "Refresh Students"}
          </button>
          <button
            title="⌘s or <ctrl-s> to save"
            onClick={handleSaveChanges}
            disabled={isProcessing || !adminPassword}
            className="bg-primary text-on-primary font-bold py-2 px-4 rounded-lg shadow-[0_0_15px_rgba(129,236,255,0.3)] hover:shadow-[0_0_20px_rgba(129,236,255,0.5)] transition-all disabled:opacity-50 disabled:cursor-not-allowed font-body"
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
        </div>

        {/* Format Help */}
        <div className="mb-6 border border-outline-variant/20 rounded-lg overflow-hidden">
          <button
            onClick={() => setIsFormatGuideOpen(!isFormatGuideOpen)}
            className="w-full p-4 text-left flex justify-between items-center bg-surface-container-low hover:bg-surface-container-high transition-colors"
          >
            <h3 className="font-headline font-bold text-on-surface">Format Guide</h3>
            <span className="text-primary text-xl font-light">{isFormatGuideOpen ? '−' : '+'}</span>
          </button>
          {isFormatGuideOpen && (
            <div className="bg-surface-container border-x border-b border-outline-variant/20 p-4">
              <p className="font-body text-sm text-on-surface-variant mb-4">
                Students can be defined in three formats:
              </p>
              <div className="space-y-4 text-sm font-body">
                <div>
                  <strong className="text-on-surface">1. Simple format (email only):</strong>
                  <pre className="bg-surface-container-low border border-outline-variant/20 p-3 rounded mt-2 overflow-x-auto text-tertiary">
{`[
  "student1@example.com",
  "student2@example.com"
]`}
                  </pre>
                </div>
                <div>
                  <strong className="text-on-surface">2. Extended format (individual with groups):</strong>
                  <pre className="bg-surface-container-low border border-outline-variant/20 p-3 rounded mt-2 overflow-x-auto text-tertiary">
{`[
  { "email": "student1@example.com", "group": "5CI" },
  { "email": "student2@example.com", "group": "4BI" }
]`}
                  </pre>
                </div>
                <div>
                  <strong className="text-on-surface">3. Group format (multiple students in same group):</strong>
                  <pre className="bg-surface-container-low border border-outline-variant/20 p-3 rounded mt-2 overflow-x-auto text-tertiary">
{`[
  {
    "group": "5CI",
    "emails": [
      "student1@example.com",
      "student2@example.com"
    ]
  },
  { "group": "4BI", "emails": ["student3@example.com"] }
]`}
                  </pre>
                </div>
                <p className="text-on-surface-variant">
                  <strong className="text-on-surface">Note:</strong> All entries must have valid email addresses.
                  You can mix all three formats in the same list.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* JSON Editor Area */}
        <textarea
          value={studentsJson}
          onChange={(e) => setStudentsJson(e.target.value)}
          disabled={isProcessing || !adminPassword || isLoadingStudents}
          placeholder={
            isLoadingStudents
              ? "Loading students..."
              : isLoadError
                ? "Error loading students. Check console."
                : "Edit students JSON here..."
          }
          rows={20}
          className="bg-surface-container-low border border-outline-variant/30 text-on-surface focus:border-primary/50 focus:outline-none rounded-lg font-mono text-sm w-full p-3 disabled:opacity-50 disabled:cursor-not-allowed"
          spellCheck="false"
        />

        {/* Preview Area */}
        <div className="mt-6 p-4 border border-outline-variant/20 rounded-lg bg-surface-container-low">
          <h3 className="font-headline font-bold text-on-surface text-lg mb-4">Preview</h3>
          {previewParsed.error ? (
            <div className="bg-secondary/10 border border-secondary/20 text-secondary px-3 py-2 rounded-lg mb-4 font-body">
              {previewParsed.error}
            </div>
          ) : null}
          {(() => {
            const students = previewParsed.students;
            if (!students) return null;
            if (students.length === 0)
              return <div className="text-on-surface-variant font-body">No students to preview.</div>;

            return (
              <div className="space-y-4">
                <div className="text-sm text-on-surface-variant font-body">
                  Total students: <strong className="text-on-surface">{totalEmails}</strong>
                </div>
                {Object.entries(groupedStudents).map(([group, emails]) => (
                  <div key={group} className="border border-outline-variant/20 rounded-lg p-4 bg-surface-container">
                    <h4 className="font-headline font-bold text-on-surface text-base mb-3">{group}</h4>
                    <ul className="space-y-2">
                      {emails.map((email, idx) => (
                        <li key={idx} className="text-sm flex items-center gap-3 font-body">
                          <span className="text-outline-variant">{idx + 1}.</span>
                          <span className={isValidEmail(email) ? "text-tertiary" : "text-error"}>
                            {isValidEmail(email) ? "✓" : "✗"}
                          </span>
                          <span className={isValidEmail(email) ? "text-on-surface" : "text-error"}>
                            {email}
                            {!isValidEmail(email) && " ⚠️ Invalid email"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {isProcessing && (
          <div className="mt-4 text-primary font-body animate-pulse">Processing...</div>
        )}
      </div>
    </AdminLayout>
  );
};

export default AdminStudentsPage;
