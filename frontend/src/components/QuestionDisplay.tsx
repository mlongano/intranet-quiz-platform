// frontend/src/components/QuestionDisplay.tsx (New file - basic structure)
import React, { useEffect, useRef } from "react";
import { Question, Answer, OptionObject } from "../api"; // Import types

interface Props {
  question: Question;
  currentAnswer: Answer;
  onAnswerChange: (answer: Answer) => void;
}

function QuestionDisplay({ question, currentAnswer, onAnswerChange }: Props) {
  // --- NEW: Helper to get text from option ---
  const getOptionText = (option: string | OptionObject): string => {
    return typeof option === "string" ? option : option.text;
  };

  // --- NEW: Helper to get image path from option ---
  const getOptionImage = (
    option: string | OptionObject,
  ): string | undefined => {
    return typeof option === "string" ? undefined : option.image;
  };

  const handleOpenChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onAnswerChange(e.target.value);
  };

  const handleOptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedIndex = Number(e.target.value);
    if (question.type === "single") {
      onAnswerChange(selectedIndex);
    } else if (question.type === "multiple") {
      const currentSelection = (currentAnswer as number[] | null) ?? [];
      if (e.target.checked) {
        onAnswerChange([...currentSelection, selectedIndex].sort()); // Keep sorted
      } else {
        onAnswerChange(currentSelection.filter((val) => val !== selectedIndex));
      }
    }
  };

  const quizContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const quizElement = quizContainerRef.current;
    console.log("Try to prevent selection and context menu");

    const preventSelection = (event: Event) => {
      event.preventDefault();
    };

    const preventContextMenu = (event: Event) => {
      event.preventDefault();
    };

    if (quizElement) {
      quizElement.addEventListener("selectstart", preventSelection);
      quizElement.addEventListener("contextmenu", preventContextMenu);
    }

    // Cleanup listener on component unmount
    return () => {
      if (quizElement) {
        quizElement.removeEventListener("selectstart", preventSelection);
        quizElement.removeEventListener("contextmenu", preventContextMenu);
      }
    };
  }, []); // Empty dependency array ensures this runs once on mount

  return (
    <div className="space-y-4" ref={quizContainerRef}>
      {/* --- NEW: Display question image --- */}
      {question.question_image && (
        <img
          src={question.question_image}
          alt={`Question ${question.qid} image`}
          className="question-image my-4 mx-auto block max-w-full h-auto max-h-60 rounded" // Add styling class
        />
      )}

      <p className="text-lg font-medium mb-4">{question.text}</p>

      {question.type === "open" && (
        <textarea
          value={(currentAnswer as string) || ""}
          onChange={handleOpenChange}
          rows={4}
          className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
          placeholder="Enter your answer..."
        />
      )}

      {(question.type === "single" || question.type === "multiple") && (
        <div className="space-y-2">
          {question.options.map((option, index) => (
            <label
              key={index}
              className="flex items-center p-3 border rounded hover:bg-gray-50 cursor-pointer"
            >
              <input
                type={question.type === "single" ? "radio" : "checkbox"}
                name={`q_${question.qid}`} // Use unique name for radio group
                value={index}
                checked={
                  question.type === "single"
                    ? currentAnswer === index
                    : ((currentAnswer as number[]) || []).includes(index)
                }
                onChange={handleOptionChange}
                className={
                  question.type === "single"
                    ? "h-4 w-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"
                    : "h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                }
              />
              {/* Display option text */}
              <span className="ml-3 text-gray-800">
                {getOptionText(option)}
              </span>
              {/* NEW: Display option image */}
              {getOptionImage(option) && (
                <img
                  src={getOptionImage(option)}
                  alt={`Option ${index + 1}`}
                  className="option-image ml-2 h-10 w-auto object-contain" // Add styling class
                />
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default QuestionDisplay;
