// frontend/src/pages/ErrorPage.tsx (with Tailwind)
import { useRouteError, Link } from "react-router-dom";

function ErrorPage() {
  const error: any = useRouteError();
  console.error(error);

  return (
    <div className="container mx-auto p-8 text-center max-w-lg">
      <h1 className="text-4xl font-bold mb-4 text-red-600">Oops!</h1>
      <p className="text-gray-700 mb-2">
        Sorry, an unexpected error has occurred.
      </p>
      <p className="text-gray-500 italic mb-6">
        {error?.statusText || error?.message || "Unknown error"}
      </p>
      <Link
        to="/"
        className="inline-block px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
      >
        Go Home
      </Link>
    </div>
  );
}
export default ErrorPage;
