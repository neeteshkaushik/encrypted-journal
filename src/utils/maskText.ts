const wordCharacter = /[\p{L}\p{N}_]/u

export function maskCompletedWords(value: string): string {
  const characters = Array.from(value)
  let trailingWordStart = characters.length

  while (trailingWordStart > 0 && wordCharacter.test(characters[trailingWordStart - 1])) {
    trailingWordStart -= 1
  }

  return characters
    .map((character, index) => {
      if (index < trailingWordStart && !/\s/u.test(character)) {
        return '•'
      }

      return character
    })
    .join('')
}
