export const AlertType = {
  Script: 'Script',
  Header: 'Header',
} as const

export type AlertType = (typeof AlertType)[keyof typeof AlertType]
