import { describe, it, expect } from 'vitest';
import { prettifySlugTitle } from '../lib/utils';

describe('prettifySlugTitle', () => {
  it('converts hyphenated slug to title case', () => {
    expect(prettifySlugTitle('java-concurrency-and-multithreading'))
      .toBe('Java Concurrency And Multithreading');
  });

  it('handles single word', () => {
    expect(prettifySlugTitle('quiz')).toBe('Quiz');
  });

  it('handles empty string', () => {
    expect(prettifySlugTitle('')).toBe('');
  });

  it('handles underscores too', () => {
    expect(prettifySlugTitle('hello_world_test')).toBe('Hello World Test');
  });
});
