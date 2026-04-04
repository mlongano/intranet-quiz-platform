// frontend/src/pages/FinishPage.tsx
import { Link } from "react-router-dom";
import ThemeToggle from "../components/ThemeToggle";

function FinishPage() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>
      <div className="bg-surface-container rounded-lg border border-outline-variant/30 p-8 max-w-md w-full text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-2xl font-bold mb-3 text-tertiary">Thanks!</h2>
        <p className="text-on-surface-variant mb-8">
          Your submission has been recorded.
        </p>
        <Link
          to="/"
          className="inline-block px-6 py-2 bg-primary text-on-primary font-medium rounded-md hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-opacity"
        >
          Back to Start
        </Link>
      </div>
    </div>
  );
}

export default FinishPage;
