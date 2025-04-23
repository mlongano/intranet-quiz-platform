// frontend/src/pages/FinishPage.tsx (with Tailwind)
import { Link } from "react-router-dom";

function FinishPage() {
  return (
    <div className="container mx-auto p-8 text-center max-w-lg">
      <h2 className="text-2xl font-bold mb-4 text-green-700">Thanks!</h2>
      <p className="text-gray-700 mb-6">Your submission has been recorded.</p>
      <Link
        to="/"
        className="inline-block px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
      >
        Back to Start
      </Link>
    </div>
  );
}
export default FinishPage;
