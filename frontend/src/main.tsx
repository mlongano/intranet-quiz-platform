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
import AdminScoresPage from "./pages/AdminScoresPage";
import AdminQuestionEditorPage from "./pages/AdminQuestionEditorPage";
import AdminDashboardPage from "./pages/AdminDashboardPage";
import AdminBankManagerPage from "./pages/AdminBankManagerPage"; // Assuming this file is in ./pages
import AdminScoresBankPage from "./pages/AdminScoresBankPage";
import AdminScoresBankReviewPage from "./pages/AdminScoresBankReviewPage";
import AdminStudentsPage from "./pages/AdminStudentsPage";
import AdminStudentsBankPage from "./pages/AdminStudentsBankPage";
import AdminImageManagerPage from "./pages/AdminImageManagerPage";

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
      { path: "dashboard", element: <AdminDashboardPage /> }, //  at /admin/root
      { path: "scores", element: <AdminScoresPage /> }, // Dashboard at /admin/dashboard
      // Add route for detail view later:
      // { path: 'review/:studentId', element: <SubmissionDetailView /> },
      //   { // Add the new route for the question editor
      {
        path: "questions",
        element: <AdminQuestionEditorPage />,
      },
      {
        path: "questions-bank", // This will make the route /admin/questions-bank
        element: <AdminBankManagerPage />, // The component to manage bank files
      },
      {
        path: "scores-bank", // This will make the route /admin/bank
        element: <AdminScoresBankPage />, // The component to manage bank files
      },
      {
        path: "scores-bank-review", // This will make the route /admin/scores-bank-review
        element: <AdminScoresBankReviewPage />, // Component to review scores from bank
      },
      {
        path: "students", // This will make the route /admin/students
        element: <AdminStudentsPage />, // The component to manage students list
      },
      {
        path: "students-bank", // This will make the route /admin/students-bank
        element: <AdminStudentsBankPage />, // The component to manage students bank
      },
      {
        path: "images", // This will make the route /admin/images
        element: <AdminImageManagerPage />, // The component to manage quiz images
      },
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
