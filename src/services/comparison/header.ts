import type { IHeaderComparisonService } from '../../interfaces/comparison'
import type { HeaderComparisonSummary } from '../../types/comparison'
import type { HeaderDetectionSummary, HeaderName, HeaderValues } from '../../types/header'
import type { Inventory } from '../../types/inventory/model'
import type { Target } from '../../types/target'

export class HeaderComparisonService implements IHeaderComparisonService {
  compare(target: Target, inventory: Inventory, headerDetectionSummary: HeaderDetectionSummary): Promise<HeaderComparisonSummary> {
    const inventoryHeaders = inventory.headers
    const detectedHeaders = headerDetectionSummary.headers
    const detectedHeaderNames = detectedHeaders.keys()

    let maybeUnauthorisedHeaders: Map<HeaderName, HeaderValues> | undefined

    for (const detectedHeaderName of detectedHeaderNames) {
      // Attempt to match on header name
      const headerNameMatchers = inventoryHeaders.filter((header) => header.nameMatcher.test(detectedHeaderName))

      // If there is no match, add current detected header + values to unauthorised set
      if (headerNameMatchers.length === 0) {
        this.log(`No match found for detected header name '${detectedHeaderName}'.`)
        maybeUnauthorisedHeaders = new Map<HeaderName, HeaderValues>()
        maybeUnauthorisedHeaders.set(detectedHeaderName, detectedHeaders.get(detectedHeaderName)!)
      }

      // If there is a match, attempt to match on header content
      else {
        this.log(`Match found for detected header name '${detectedHeaderName}'.`)
        const detectedHeaderValues = detectedHeaders.get(detectedHeaderName)!
        const unauthorisedHeaderValues = new Set<string>()

        for (const detectedHeaderValue of detectedHeaderValues) {
          const maybeContentMatcher = headerNameMatchers.find((header) => header.contentMatcher.test(detectedHeaderValue) && header.authorisationInfo.authorised)

          if (!maybeContentMatcher) {
            this.log(`Match not found for detected header value '${detectedHeaderValue}'.`)
            const matcherExists = headerNameMatchers.find((header) => header.contentMatcher.test(detectedHeaderValue))
            if (!matcherExists) {
              unauthorisedHeaderValues.add(detectedHeaderValue)
            }
          } else {
            this.log(`Match found for detected header value '${detectedHeaderValue}'.`)
          }
        }

        // Add any unauthorised headers
        if ([...unauthorisedHeaderValues.keys()].length > 0) {
          maybeUnauthorisedHeaders = new Map<HeaderName, HeaderValues>()
          maybeUnauthorisedHeaders.set(detectedHeaderName, unauthorisedHeaderValues)
        }
      }
    }

    return Promise.resolve({
      target: target,
      unauthorisedHeaders: maybeUnauthorisedHeaders,
    })
  }

  log(message: string): void {
    console.log(`[Comparison → Header]: ${message}`)
  }
}
