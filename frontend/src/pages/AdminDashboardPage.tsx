import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { fetchScores } from "../api";

export default function AdminRootPage() {
  const location = useLocation();
  // Attempt to get password from navigation state (insecure, lost on refresh)
  const adminPassword = location.state?.adminPassword;
  const navigate = useNavigate();
  const [isValidating, setIsValidating] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Validate password on mount
  useEffect(() => {
    const validateAccess = async () => {
      if (!adminPassword) {
        // No password provided - redirect to login
        navigate("/admin", { replace: true });
        return;
      }

      try {
        // Validate password by attempting to fetch scores
        await fetchScores(adminPassword);
        setIsValidating(false);
      } catch {
        // Invalid password - show error and redirect after delay
        setValidationError("Invalid session. Redirecting to login...");
        setTimeout(() => {
          navigate("/admin", { replace: true });
        }, 2000);
      }
    };

    validateAccess();
  }, [adminPassword, navigate]);

  // Show loading while validating
  if (isValidating) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-lg">Validating access...</p>
        </div>
      </div>
    );
  }

  // Show error message if validation failed
  if (validationError) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-lg text-red-600">{validationError}</p>
        </div>
      </div>
    );
  }

  const handleScorePage = () => {
    navigate("/admin/scores", { state: { adminPassword: adminPassword } });
  };

  return (
    <>
      <header className="flex justify-between items-center px-4 py-2 bg-gray-800 text-white">
        <h1 className="text-xl font-bold">Admin Dashboard</h1>
        <nav className="p-4 bg-gray-800 text-white">
          <ul className="flex space-x-4">
            <li>
              <button
                onClick={() => {
                  navigate("/");
                }}
                className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Go to Quiz
              </button>
            </li>
            <li>
              <button
                onClick={handleScorePage}
                className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Go to Scores page
              </button>
            </li>
            <li>
              <button
                onClick={() => {
                  navigate("/admin/questions", {
                    state: { adminPassword: adminPassword },
                  });
                }}
                className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Go to Questions page
              </button>
            </li>
            <li>
              <button
                onClick={() => {
                  navigate("/admin/bank", {
                    state: { adminPassword: adminPassword },
                  });
                }}
                className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Go to Question Bank page
              </button>
            </li>
            <li>
              <button
                onClick={() => {
                  navigate("/admin/scores-bank", {
                    state: { adminPassword: adminPassword },
                  });
                }}
                className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Go to Scores Bank page
              </button>
            </li>
            <li>
              <button
                onClick={() => {
                  navigate("/admin/students", {
                    state: { adminPassword: adminPassword },
                  });
                }}
                className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Go to Students page
              </button>
            </li>
            <li>
              <button
                onClick={() => {
                  navigate("/admin/students-bank", {
                    state: { adminPassword: adminPassword },
                  });
                }}
                className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Go to Students Bank page
              </button>
            </li>
          </ul>
        </nav>
      </header>
      <main className="flex flex-col gap-2"></main>
    </>
  );
}
