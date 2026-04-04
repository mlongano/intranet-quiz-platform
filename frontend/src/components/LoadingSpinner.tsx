// frontend/src/components/LoadingSpinner.tsx

interface LoadingSpinnerProps {
  message?: string; // Optional message to display
}

function LoadingSpinner({ message = "Loading..." }: LoadingSpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center text-on-surface-variant">
      {/* Simple Spinner Animation */}
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
      {/* Display the message */}
      <p>{message}</p>
    </div>
  );
}

export default LoadingSpinner;
