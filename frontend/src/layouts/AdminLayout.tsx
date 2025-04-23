// frontend/src/layouts/AdminLayout.tsx
import { Outlet } from "react-router-dom"; // Outlet renders child routes

function AdminLayout() {
  // In a real app, context would manage login state
  // For now, child components might need to handle password prompt/storage
  // Or we lift state up / use context
  return (
    <div className="admin-container p-4">
      <h1 className="text-3xl font-bold border-b pb-2 mb-4">Admin Section</h1>
      {/* Outlet renders the matched child route (Login or Dashboard) */}
      <Outlet />
    </div>
  );
}
export default AdminLayout;
