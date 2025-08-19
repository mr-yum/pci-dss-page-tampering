export type TargetInventory = Target & {
  type: 'inventory'
}

export type TargetDetection = Target & {
  type: 'detection'
}

export type Target = {
  type: 'inventory' | 'detection'
  url: string
}
