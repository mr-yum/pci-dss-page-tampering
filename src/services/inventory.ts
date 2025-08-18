import type { ScriptSummary } from '../types/script'
import type { InventoryPayload } from '../types/inventory'

interface IScriptInventoryService {
  pull(): Promise<InventoryPayload>
  push(scriptDetectionSummary: ScriptSummary): Promise<void>
}

export class InMemoryScriptInventoryService implements IScriptInventoryService {
  async pull(): Promise<InventoryPayload> {
    throw new Error('Not implemented')
  }
  async push(_scriptDetectionSummary: ScriptSummary): Promise<void> {
    throw new Error('Not implemented')
  }
}
