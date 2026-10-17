import { describe, expect, it } from 'vitest'

import { createSerialQueue } from '../../src/utils/serialQueue'

describe('serial queue', () => {
  it('runs queued operations in order', async () => {
    const queue = createSerialQueue()
    const events: string[] = []

    const first = queue.enqueue(async () => {
      events.push('first-start')
      await new Promise((resolve) => setTimeout(resolve, 10))
      events.push('first-end')
    })
    const second = queue.enqueue(async () => {
      events.push('second')
    })

    await Promise.all([first, second])

    expect(events).toEqual(['first-start', 'first-end', 'second'])
  })

  it('continues processing after an operation rejects', async () => {
    const queue = createSerialQueue()
    const next = queue.enqueue(async () => 'next')

    await expect(queue.enqueue(async () => {
      throw new Error('save failed')
    })).rejects.toThrow('save failed')
    await expect(next).resolves.toBe('next')
    await expect(queue.idle()).resolves.toBeUndefined()
  })
})
