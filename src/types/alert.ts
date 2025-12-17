export const AlertType = {
  Script: 'Script',
  Header: 'Header',
  Success: 'Success',
} as const

export type AlertType = (typeof AlertType)[keyof typeof AlertType]
