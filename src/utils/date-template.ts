/**
 * Date templating for target URLs.
 *
 * Booking-style targets often need a future date in the URL (e.g. a
 * reservation widget's `?date=` parameter): a hardcoded date goes stale and
 * "today" runs out of availability late in the day. Target URLs may embed
 * `{{date}}` or `{{date+Nd}}` placeholders, resolved to a UTC `YYYY-MM-DD`
 * at navigation time — mirroring how Datadog Synthetics parameterise the
 * same flows.
 */

const DATE_TEMPLATE_PATTERN = /\{\{date(?:\+(\d{1,3})d)?\}\}/g

const MILLISECONDS_PER_DAY = 86_400_000

/**
 * Replace every `{{date}}` / `{{date+Nd}}` placeholder in `input` with the
 * UTC date `N` days from `now`, formatted `YYYY-MM-DD`. Text without
 * placeholders (including malformed ones like `{{date-1d}}`) is returned
 * unchanged.
 */
export function resolveDateTemplates(input: string, now: Date = new Date()): string {
  return input.replace(DATE_TEMPLATE_PATTERN, (_match, offsetDays: string | undefined) => {
    const offset = offsetDays === undefined ? 0 : Number(offsetDays)
    return new Date(now.getTime() + offset * MILLISECONDS_PER_DAY).toISOString().slice(0, 10)
  })
}
