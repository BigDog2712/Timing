import { describe, expect, it } from 'vitest';
import fixture from './fixtures/tag-path.json';

import { normalizeTagPath, normalizeTagPaths, TagPathValidationError } from './normalize';

describe('tag path rules', () => {
  for (const testCase of fixture.cases) {
    it(`matches shared fixture: ${testCase.name}`, () => {
      if (testCase.error) {
        try {
          normalizeTagPath(testCase.input);
          throw new Error('expected validation failure');
        } catch (error) {
          expect(error).toBeInstanceOf(TagPathValidationError);
          expect((error as TagPathValidationError).reason).toBe(testCase.error);
        }
      } else {
        expect(normalizeTagPath(testCase.input)).toBe(testCase.expected);
      }
    });
  }

  for (const testCase of fixture.listCases) {
    it(`matches shared list fixture: ${testCase.name}`, () => {
      expect(normalizeTagPaths(testCase.input)).toEqual(testCase.expected);
    });
  }
  it('normalizes separators, hashes, whitespace and empty segments', () => {
    expect(normalizeTagPath(' #学习 \\ 考公//')).toBe('学习/考公');
  });

  it('deduplicates case-insensitively while preserving first spelling', () => {
    expect(normalizeTagPaths(['学习', ' 学习 ', 'STUDY', 'study'])).toEqual(['学习', 'STUDY']);
  });

  it.each([
    ['too deep', 'a/b/c/d/e', 'depth'],
    ['too long', 'x'.repeat(65), 'path'],
    ['long segment', `${'x'.repeat(33)}/y`, 'segment'],
    ['control character', 'a\u0001b', 'control'],
  ])('rejects %s without truncating', (_label, input, reason) => {
    try {
      normalizeTagPath(input);
      throw new Error('expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(TagPathValidationError);
      expect((error as TagPathValidationError).reason).toBe(reason);
    }
  });

  it('rejects rather than truncating over-limit collections', () => {
    expect(() => normalizeTagPaths(Array.from({ length: 33 }, (_, index) => `tag${index}`))).toThrow(/最多只能设置/);
  });
});
