export interface SerialQueue {
  enqueue<T>(operation: () => Promise<T>): Promise<T>
  idle(): Promise<void>
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<void> = Promise.resolve()

  return {
    enqueue<T>(operation: () => Promise<T>): Promise<T> {
      const result = tail.then(operation)
      tail = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    },
    idle(): Promise<void> {
      return tail
    },
  }
}
