// frontend/src/components/ErrorDisplay.tsx

interface ErrorDisplayProps {
  message: string | null | undefined; // Accept null or undefined to hide component
  title?: string; // Optional title for the error box
}

function ErrorDisplay({ message, title = "Error" }: ErrorDisplayProps) {
  // Don't render anything if there's no message
  if (!message) {
    return null;
  }

  return (
    // Styling for the error box using Tailwind CSS
    <div
      className="my-4 p-4 bg-red-50 border border-red-300 text-red-800 rounded-lg shadow-sm"
      role="alert"
    >
      {/* Optional title */}
      <p className="font-semibold mb-1">{title}</p>
      {/* The error message */}
      <p className="text-sm">{message}</p>
    </div>
  );
}

export default ErrorDisplay;
