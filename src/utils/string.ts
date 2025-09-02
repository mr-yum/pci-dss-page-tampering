/**
 * Escapes special characters in a string for use in a regular expression.
 * @param {string} str The string to escape.
 * @returns {string} The escaped string.
 */
export function escapeRegex(str: string): string {
  // The characters to escape are: . * + ? ^ $ { } ( ) | [ ] \
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // $& means the whole matched string
}

export function capitalise(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}
