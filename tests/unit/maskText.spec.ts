import { describe, expect, it } from 'vitest'

import { maskCompletedWords } from '../../src/utils/maskText'

describe('maskCompletedWords', () => {
  it('leaves an unfinished trailing word visible', () => {
    expect(maskCompletedWords('meet me')).toBe('•••• me')
  })

  it('masks every word when the text ends with punctuation', () => {
    expect(maskCompletedWords('hello.')).toBe('••••••')
    expect(maskCompletedWords('hello, world!')).toBe('•••••• ••••••')
  })

  it('preserves whitespace and line breaks', () => {
    expect(maskCompletedWords('first line\nsecond')).toBe('••••• ••••\nsecond')
  })

  it('leaves a word visible when no completed text precedes it', () => {
    expect(maskCompletedWords('unfinished')).toBe('unfinished')
  })

  it('handles empty text', () => {
    expect(maskCompletedWords('')).toBe('')
  })
})
