// frontend/src/pages/AdminLoginPage.tsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchScores } from "../api"; // Import to validate password
import ThemeToggle from "../components/ThemeToggle";

function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!password) {
      setError("Password is required.");
      return;
    }

    // Validate password by attempting to fetch scores
    setIsValidating(true);
    try {
      await fetchScores(password);
      // If successful, password is valid - navigate to dashboard
      console.log("Password validated successfully");
      navigate("/admin/dashboard", { state: { adminPassword: password } });
    } catch (err: any) {
      // Password is incorrect or server error
      setError(err.message || "Invalid password. Please try again.");
      console.error("Login failed:", err);
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>
      <div className="bg-surface-container rounded-xl border border-outline-variant/20 p-8 w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-headline font-bold text-on-surface mb-1">QuizParty</h1>
          <p className="text-sm text-on-surface-variant">Admin Panel</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-on-surface-variant mb-1.5 block">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Enter admin password"
              className="w-full px-3 py-2 bg-surface-container-high border border-outline-variant/30 rounded-lg text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-colors"
            />
          </label>
          <button
            type="submit"
            disabled={isValidating}
            className="w-full px-4 py-2.5 bg-primary text-on-primary font-semibold rounded-lg hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isValidating ? "Validating…" : "Login"}
          </button>
          {error && (
            <p className="text-error text-sm text-center">{error}</p>
          )}
        </form>
      </div>
    </div>
  );
}
export default AdminLoginPage;
