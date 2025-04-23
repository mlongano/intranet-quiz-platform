// frontend/src/main.tsx
import "./main.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// Optional DevTools:
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

// Import your page components (create these files)
import StartPage from "./pages/StartPage";
import QuizPage from "./pages/QuizPage";
import FinishPage from "./pages/FinishPage";
import ErrorPage from "./pages/ErrorPage"; // A general error boundary/page
import AdminLayout from "./layouts/AdminLayout";
import AdminLoginPage from "./pages/AdminLoginPage";
import AdminDashboardPage from "./pages/AdminDashboardPage";

// Create a client
const queryClient = new QueryClient();

// Define routes
const router = createBrowserRouter([
  // --- Student Routes ---
  {
    path: "/",
    element: <StartPage />,
    errorElement: <ErrorPage />, // Basic error handling for routing/loading
  },
  {
    // Use quizId as a URL parameter
    path: "/quiz/:quizId",
    element: <QuizPage />,
    errorElement: <ErrorPage />,
  },
  {
    path: "/finish",
    element: <FinishPage />,
    errorElement: <ErrorPage />,
  },
  // --- Admin Routes ---
  {
    path: "/admin",
    // Use a layout component if you want shared elements (like sidebar, header)
    // Or just render the login page directly if no layout needed yet
    element: <AdminLayout />, // Or <AdminLoginPage /> directly if no layout
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <AdminLoginPage /> }, // Login page at /admin
      { path: "dashboard", element: <AdminDashboardPage /> }, // Dashboard at /admin/dashboard
      // Add route for detail view later:
      // { path: 'review/:studentId', element: <SubmissionDetailView /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      {/* Optional DevTools */}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </React.StrictMode>,
);
