// frontend/src/pages/AdminLoginPage.tsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
// We need a way to store the password for subsequent requests.
// WARNING: Storing plain password in JS state is not ideal security,
// but matches the current backend. Use Context or Zustand for better state sharing.
// For simplicity now, we'll pass it via navigation state (can be lost on refresh).
// A better approach involves proper auth state management (Context/Zustand/Redux).

function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!password) {
      setError("Password is required.");
      return;
    }
    // Basic check: Try fetching scores to validate password.
    // In a real app, you'd have a dedicated login endpoint.
    // For now, we navigate and pass the password via state.
    // The dashboard will use this password to fetch.
    // NOTE: This password will be lost if the page is refreshed on the dashboard.
    // A proper auth state solution (Context/Zustand) is needed for persistence.
    console.log(
      "Navigating to dashboard, passing password in state (insecure for refresh)",
    );
    navigate("/admin/root", { state: { adminPassword: password } });

    // ---- OR ----
    // If using a state management library (like Zustand):
    // import useAuthStore from './store/authStore'; // Example store
    // const { login } = useAuthStore();
    // login(password); // Store password securely (or better, a token)
    // navigate('/admin/dashboard');
  };

  return (
    <div className="max-w-sm mx-auto mt-10">
      <h2 className="text-xl font-semibold mb-4">Admin Login</h2>
      <form onSubmit={handleLogin} className="space-y-3">
        <label className="block">
          <span className="text-gray-700">Password:</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="mt-1 p-2 w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
          />
        </label>
        <button
          type="submit"
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
        >
          Login
        </button>
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
      </form>
    </div>
  );
}
export default AdminLoginPage;
