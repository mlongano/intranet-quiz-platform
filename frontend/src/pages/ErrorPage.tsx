// frontend/src/pages/ErrorPage.tsx
import { useRouteError, Link } from "react-router-dom";
import ThemeToggle from "../components/ThemeToggle";

function ErrorPage() {
  const error: any = useRouteError();
  console.error(error);

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>
      <div className="bg-surface-container rounded-lg border border-outline-variant/30 p-8 max-w-md w-full text-center">
        <h1 className="text-4xl font-bold mb-4 text-error">Oops!</h1>
        <p className="text-on-surface mb-2">
          Sorry, an unexpected error has occurred.
        </p>
        <p className="text-on-surface-variant italic mb-8">
          {error?.statusText || error?.message || "Unknown error"}
        </p>
        <Link
          to="/"
          className="inline-block px-6 py-2 bg-primary text-on-primary font-medium rounded-md hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-opacity"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}

export default ErrorPage;
