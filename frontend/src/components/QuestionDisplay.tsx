// frontend/src/components/QuestionDisplay.tsx (New file - basic structure)
import React from "react";
import { Question, Answer } from "../api"; // Import types

interface Props {
  question: Question;
  currentAnswer: Answer;
  onAnswerChange: (answer: Answer) => void;
}

function QuestionDisplay({ question, currentAnswer, onAnswerChange }: Props) {
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

  return (
    <div className="space-y-4">
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
          {question.options.map((optionText, index) => (
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
              <span className="ml-3 text-gray-800">{optionText}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default QuestionDisplay;
