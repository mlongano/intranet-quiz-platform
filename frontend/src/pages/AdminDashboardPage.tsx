import { useLocation, useNavigate } from "react-router-dom";

export default function AdminRootPage() {
  const location = useLocation();
  // Attempt to get password from navigation state (insecure, lost on refresh)
  const adminPassword = location.state?.adminPassword;
  const navigate = useNavigate();

  const handleScorePage = () => {
    navigate("/admin/scores", { state: { adminPassword: adminPassword } });
  };

  return (
    <main className="flex flex-col gap-2">
      <button
        onClick={handleScorePage}
        className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-md shadow-sm hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Go to Scores page
      </button>
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
    </main>
  );
}
