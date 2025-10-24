import type { Target } from '../types/target'

export interface Logger {
  log: (message: string, ...args: any[]) => void
  error: (message: string, ...args: any[]) => void
  warn: (message: string, ...args: any[]) => void
  debug: (message: string, ...args: any[]) => void
}

/**
 * Creates a logger with a prefix based on the target URL
 * @param target - Target object containing URL and type
 * @returns Logger instance with prefixed methods
 */
export function createTargetLogger(target: Target): Logger {
  const prefix = `[${target.type}:${target.url}]`

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
