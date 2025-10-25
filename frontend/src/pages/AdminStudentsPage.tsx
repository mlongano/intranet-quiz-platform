// frontend/src/pages/AdminStudentsPage.tsx

import { useState, useEffect, useCallback, useMemo } from "react";
import { parse, ParseError } from "jsonc-parser";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchStudents, updateStudents, StudentEntry } from "../api";
import { useLocation, useNavigate } from "react-router-dom";

const AdminStudentsPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
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
    return <div>Loading editor...</div>;
  }

  if (userMessage?.type === "error" && adminPassword === null) {
    return <div className="text-red-500 font-bold p-4">{userMessage.text}</div>;
  }

  if (isLoadingStudents && !studentsData) {
    return <div className="p-4">Loading students...</div>;
  }

  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-start items-center mb-2">
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

      <h2 className="text-2xl font-bold mb-4">Student List Editor</h2>

      {/* Error/Success Messages */}
      {isLoadError && (
        <div
          className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4"
          role="alert"
        >
          Load failed: {loadError?.message || "Unknown error"}
        </div>
      )}
      {isSaveError && !isSaving && (
        <div
          className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4"
          role="alert"
        >
          Save failed: {saveError?.message || "Unknown error"}
        </div>
      )}
      {userMessage && (
        <div
          className={`border px-4 py-3 rounded relative mb-4 ${userMessage.type === "success"
              ? "bg-green-100 border-green-400 text-green-700"
              : "bg-yellow-100 border-yellow-400 text-yellow-700"
            }`}
          role="alert"
        >
          {userMessage.text}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-4 mb-4">
        <button
          onClick={() => refetchStudents()}
          disabled={isProcessing || !adminPassword}
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
        >
          {isFetchingStudents ? "Refreshing..." : "Refresh Students"}
        </button>
        <button
          title="⌘s or <ctrl-s> to save"
          onClick={handleSaveChanges}
          disabled={isProcessing || !adminPassword}
          className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Save Changes"}
        </button>
      </div>

      {/* Format Help */}
      <div className="mb-4 border rounded bg-blue-50">
        <button
          onClick={() => setIsFormatGuideOpen(!isFormatGuideOpen)}
          className="w-full p-4 text-left flex justify-between items-center hover:bg-blue-100 transition-colors"
        >
          <h3 className="text-lg font-semibold">Format Guide</h3>
          <span className="text-2xl">{isFormatGuideOpen ? '−' : '+'}</span>
        </button>
        {isFormatGuideOpen && (
          <div className="p-4 pt-0">
            <p className="text-sm text-gray-700 mb-2">
              Students can be defined in three formats:
            </p>
            <div className="space-y-2 text-sm">
              <div>
                <strong>1. Simple format (email only):</strong>
                <pre className="bg-gray-100 p-2 rounded mt-1 overflow-x-auto">
                  {`[
  "student1@example.com",
  "student2@example.com"
]`}
                </pre>
              </div>
              <div>
                <strong>2. Extended format (individual with groups):</strong>
                <pre className="bg-gray-100 p-2 rounded mt-1 overflow-x-auto">
                  {`[
  { "email": "student1@example.com", "group": "5CI" },
  { "email": "student2@example.com", "group": "4BI" }
]`}
                </pre>
              </div>
              <div>
                <strong>3. Group format (multiple students in same group):</strong>
                <pre className="bg-gray-100 p-2 rounded mt-1 overflow-x-auto">
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
              <p className="text-gray-600">
                <strong>Note:</strong> All entries must have valid email addresses.
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
        className="w-full p-2 border rounded font-mono text-sm bg-gray-50 disabled:opacity-70"
        spellCheck="false"
      />

      {/* Preview Area */}
      <div className="mt-6 p-4 border rounded bg-white">
        <h3 className="text-xl font-semibold mb-3">Preview</h3>
        {previewParsed.error ? (
          <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-3 py-2 rounded mb-3">
            {previewParsed.error}
          </div>
        ) : null}
        {(() => {
          const students = previewParsed.students;
          if (!students) return null;
          if (students.length === 0)
            return <div className="text-gray-600">No students to preview.</div>;

          return (
            <div className="space-y-4">
              <div className="text-sm text-gray-600">
                Total students: <strong>{totalEmails}</strong>
              </div>
              {Object.entries(groupedStudents).map(([group, emails]) => (
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
          );
        })()}
      </div>

      {isProcessing && <div className="mt-2 text-blue-600">Processing...</div>}
    </div>
  );
};

export default AdminStudentsPage;
