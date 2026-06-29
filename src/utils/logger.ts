import type { Target } from '../types/target.js'

export interface Logger {
  log: (message: string, ...args: any[]) => void
  error: (message: string, ...args: any[]) => void
  warn: (message: string, ...args: any[]) => void
  debug: (message: string, ...args: any[]) => void
}

/**
 * Creates a logger with a prefix based on the target name (or URL if name not provided)
 * @param target - Target object containing name (optional), URL, and type
 * @returns Logger instance with prefixed methods
 */
export function createTargetLogger(target: Target): Logger {
  // Use name if provided, otherwise fall back to URL for backward compatibility
  const identifier = target.name ?? target.url
  const prefix = `[${target.type}:${identifier}]`

  return {
    log: (message: string, ...args: any[]): void => {
      console.log(`${prefix} ${message}`, ...args)
    },
    error: (message: string, ...args: any[]): void => {
      console.error(`${prefix} ${message}`, ...args)
    },
    warn: (message: string, ...args: any[]): void => {
      console.warn(`${prefix} ${message}`, ...args)
    },
    debug: (message: string, ...args: any[]): void => {
      console.debug(`${prefix} ${message}`, ...args)
    },
  }
}

/**
 * Creates a logger with a custom prefix
 * @param prefix - Custom prefix for log messages
 * @returns Logger instance with prefixed methods
 */
export function createLogger(prefix: string): Logger {
  const formattedPrefix = `[${prefix}]`

  return {
    log: (message: string, ...args: any[]): void => {
      console.log(`${formattedPrefix} ${message}`, ...args)
    },
    error: (message: string, ...args: any[]): void => {
      console.error(`${formattedPrefix} ${message}`, ...args)
    },
    warn: (message: string, ...args: any[]): void => {
      console.warn(`${formattedPrefix} ${message}`, ...args)
    },
    debug: (message: string, ...args: any[]): void => {
      console.debug(`${formattedPrefix} ${message}`, ...args)
    },
  }
}
