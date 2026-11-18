import { describe, expect, it } from 'vitest';
import { createMockApiTagsAi } from './browserMockTagsAi';
import { seed } from './mockSeed';

describe('tag and AI browser mock contracts', () => {
  it('rejects an over-limit tag collection without mutating state', () => {
    const state = seed();
    const before = structuredClone(state.itemTags[2]);
    const api = createMockApiTagsAi(state);
    expect(() => api.set_item_tags({ itemId: 2, tags: Array.from({ length: 33 }, (_, i) => `tag${i}`) })).toThrow();
    expect(state.itemTags[2]).toEqual(before);
  });

  it('preserves the saved key when apiKey is omitted or null and clears on empty string', () => {
    const state = seed();
    const api = createMockApiTagsAi(state);
    const config = { enabled: true };
    expect((api.ai_config_save({ config, apiKey: 'secret' }) as { hasKey: boolean }).hasKey).toBe(true);
    expect((api.ai_config_save({ config }) as { hasKey: boolean }).hasKey).toBe(true);
    expect((api.ai_config_save({ config, apiKey: null }) as { hasKey: boolean }).hasKey).toBe(true);
    expect((api.ai_config_save({ config, apiKey: '' }) as { hasKey: boolean }).hasKey).toBe(false);
  });
});
