import type { HeaderName, HeaderValues } from '../types/header'
import type { InventoryHeaderInfo } from '../types/inventory/model'

export function unauthorisedHeadersToInventoryHeaderInfo(headers: Map<HeaderName, HeaderValues>, date: Date): InventoryHeaderInfo[] {
  return [...headers].flatMap(([headerName, headerValues]) => {
    const headerValuesArray = [...headerValues.values()]
    return headerValuesArray.map<InventoryHeaderInfo>((headerValue) => {
      return {
        nameMatcher: RegExp(`^${headerName}$`),
        contentMatcher: RegExp(`^${headerValue}$`),
        authorisationInfo: {
          description: 'NO_DESCRIPTION',
          authorised: false,
          date: date,
        },
      }
    })
  })
}
