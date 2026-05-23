/**
 * Utility functions for the application
 */

/**
 * Converts a string to a URL-safe slug format
 * - Removes accents and diacritics
 * - Converts to lowercase
 * - Replaces spaces with hyphens
 * - Removes special characters (except hyphens)
 * - Removes multiple consecutive hyphens
 *
 * @param text - The text to slugify
 * @returns A URL-safe slug string
 *
 * @example
 * slugify("Java Concurrency and Multithreading")
 * // Returns: "java-concurrency-and-multithreading"
 *
 * slugify("Test à l'école")
 * // Returns: "test-a-lecole"
 */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/[^\w-]+/g, '') // Remove non-word chars except hyphens
    .replace(/--+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-+/, '') // Trim hyphens from start
    .replace(/-+$/, ''); // Trim hyphens from end
}

/**
 * Prettify a slug-like title: reverse of slugify for display.
 * "3ai-info-2q-esercizi-fatti-e-oop-in-java" → "3ai info 2q Esercizi Fatti E Oop In Java"
 */
export function prettifySlugTitle(title: string): string {
  return title
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}
