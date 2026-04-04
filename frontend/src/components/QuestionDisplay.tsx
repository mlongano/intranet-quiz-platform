// frontend/src/components/QuestionDisplay.tsx (New file - basic structure)
import React, { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import rehypePrism from "rehype-prism-plus";
import { Question, Answer, OptionObject } from "../api"; // Import types
import Prism from "prismjs";

import "../prism-themes.css";
import "prismjs/plugins/line-numbers/prism-line-numbers.css";
import "prismjs/plugins/line-numbers/prism-line-numbers";

// Import common languages to reduce unknown language errors
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-python";
import "prismjs/components/prism-java";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-css";
import "prismjs/components/prism-markup"; // HTML/XML
import "prismjs/components/prism-json";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-sql";

interface Props {
  question: Question;
  currentAnswer: Answer;
  onAnswerChange: (answer: Answer) => void;
  readOnly?: boolean; // If true, disable inputs and don't change answers
  highlightIndices?: number[]; // Indices to visually highlight (e.g., correct answers)
  // If true, also disable copy/context menu/selection (used in live quiz view)
  disableCopy?: boolean;
}

function QuestionDisplay({
  question,
  currentAnswer,
  onAnswerChange,
  readOnly = false,
  highlightIndices = [],
  disableCopy = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Re-run Prism highlighting when question changes
  useEffect(() => {
    if (containerRef.current) {
      // Use a small delay to ensure DOM is fully rendered
      const timeoutId = setTimeout(() => {
        try {
          if (containerRef.current) {
            Prism.highlightAllUnder(containerRef.current);
          }
        } catch (error) {
          // Silently ignore Prism errors (e.g., unknown languages in code blocks)
          console.warn('Prism highlighting error (ignored):', error);
        }
      }, 50);

      return () => clearTimeout(timeoutId);
    }
  }, [question.id, question.text, question.options]);  // Custom markdown component sizes for options
  const optionMarkdownComponents: Components = {
    h1: (props: any) => (
      <h3
        {...props}
        className={`text-base font-semibold ${props.className || ""}`}
      />
    ),
    h2: (props: any) => (
      <h4
        {...props}
        className={`text-base font-semibold ${props.className || ""}`}
      />
    ),
    h3: (props: any) => (
      <h5
        {...props}
        className={`text-base font-semibold ${props.className || ""}`}
      />
    ),
    // Ensure pre blocks have line-numbers class AND preserve language class
    pre: ({ children, ...props }: any) => {
      // Extract the language from the code element if present
      const codeElement = React.Children.toArray(children).find(
        (child): child is React.ReactElement =>
          React.isValidElement(child) && child.type === "code"
      ) as React.ReactElement<{ className?: string }> | undefined;

      const className = codeElement?.props?.className || "";
      const languageMatch = className.match(/language-(\w+)/);
      const language = languageMatch ? languageMatch[1] : "";

      // Ensure both line-numbers and language-* classes are present
      const preClassName = `line-numbers ${language ? `language-${language}` : ""} ${props.className || ""}`.trim();

      return (
        <pre {...props} className={preClassName}>
          {children}
        </pre>
      );
    },
  };
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
    if (readOnly) return;
    onAnswerChange(e.target.value);
  };

  const handleOptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (readOnly) return;
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

  const cleanMarkdown = (text: string) => {
    if (!text) return "";
    return text.replace(/([^\n])```$/g, "$1\n```");
  };

  return (
    <div className="space-y-4" ref={containerRef}>
      {/* --- NEW: Display question image --- */}
      {question.question_image && (
        <img
          src={question.question_image}
          alt={`Question ${question.id} image`}
          className="question-image my-4 mx-auto block max-w-full h-auto max-h-60 rounded" // Add styling class
        />
      )}

      {/* Render question text as Markdown */}
      <div
        className="text-lg font-medium mb-4 prose prose-sm max-w-none dark:prose-invert"
        onCopy={(e) => {
          if (disableCopy) e.preventDefault();
        }}
        onContextMenu={(e) => {
          if (disableCopy) e.preventDefault();
        }}
        style={disableCopy ? { userSelect: "none", WebkitUserSelect: "none" } : undefined}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[
            rehypeSanitize,
            [rehypePrism as any, { showLineNumbers: true }]
          ]}
          components={{
            pre: ({ children, ...props }: any) => {
              // Extract the language from the code element if present
              const codeElement = React.Children.toArray(children).find(
                (child): child is React.ReactElement =>
                  React.isValidElement(child) && child.type === "code"
              ) as React.ReactElement<{ className?: string }> | undefined;

              const className = codeElement?.props?.className || "";
              const languageMatch = className.match(/language-(\w+)/);
              const language = languageMatch ? languageMatch[1] : "";

              // Ensure both line-numbers and language-* classes are present
              const preClassName = `line-numbers ${language ? `language-${language}` : ""} ${props.className || ""}`.trim();

              return (
                <pre {...props} className={preClassName}>
                  {children}
                </pre>
              );
            },
          }}
        >
          {cleanMarkdown(question.text || "")}
        </ReactMarkdown>
      </div>

      {question.type === "open" && (
        <textarea
          value={(currentAnswer as string) || ""}
          onChange={handleOpenChange}
          rows={4}
          className={`w-full p-2 border rounded-md shadow-sm focus:ring focus:ring-opacity-50 bg-surface-container-low border-outline-variant/40 text-on-surface placeholder-on-surface-variant focus:border-primary/50 focus:ring-primary/20`}
          placeholder="Enter your answer..."
          disabled={readOnly}
        />
      )}

      {(question.type === "single" || question.type === "multiple") && (
        <div className="space-y-2">
          {question.options.map((option, index) => {
            const inputId = `q_${question.id}_${index}`;
            const isHighlighted = highlightIndices.includes(index);
            const isChecked =
              readOnly
                ? isHighlighted
                : question.type === "single"
                  ? currentAnswer === index
                  : ((currentAnswer as number[]) || []).includes(index);
            return (
              <div
                key={index}
                className={`p-3 border rounded cursor-pointer transition-colors ${
                  isHighlighted
                    ? "border-tertiary/60 bg-tertiary/10 text-on-surface"
                    : "border-outline-variant/30 hover:bg-surface-container-high text-on-surface"
                }`}
              >
                <div className="flex items-start">
                  <input
                    id={inputId}
                    type={question.type === "single" ? "radio" : "checkbox"}
                    name={`q_${question.id}`}
                    value={index}
                    checked={isChecked}
                    onChange={handleOptionChange}
                    className={
                      question.type === "single"
                        ? "mt-1 h-4 w-4 text-primary border-outline-variant focus:ring-primary/30"
                        : "mt-1 h-4 w-4 text-primary border-outline-variant rounded focus:ring-primary/30"
                    }
                    disabled={readOnly}
                  />
                  <label
                    htmlFor={inputId}
                    className="ml-3 flex-1 prose prose-sm max-w-none dark:prose-invert text-on-surface"
                    onCopy={(e) => {
                      if (disableCopy) e.preventDefault();
                    }}
                    onContextMenu={(e) => {
                      if (disableCopy) e.preventDefault();
                    }}
                    style={disableCopy ? { userSelect: "none", WebkitUserSelect: "none" } : undefined}
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[
                        rehypeSanitize,
                        [rehypePrism as any, { showLineNumbers: true }]
                      ]}
                      components={optionMarkdownComponents}
                    >
                      {getOptionText(option) || ""}
                    </ReactMarkdown>
                  </label>
                  {getOptionImage(option) && (
                    <img
                      src={getOptionImage(option)}
                      alt={`Option ${index + 1}`}
                      className="option-image ml-2 h-10 w-auto object-contain"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default QuestionDisplay;
