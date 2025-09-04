import axios from 'axios'

type AnonymousTokenResponse = {
  access_token: string
  id_token: string
  expires_in: number
  is_anonymous: boolean
}

type MeAndUAuthCookie = {
  idToken: string
  expiresAt: number
  accessToken: string
  refreshToken: string | null
  isAnonymous: boolean
  authProvider: string | undefined
}

type LocationMarkerClaim = {
  Type: string
  Token: string
}

const getAnonymousTokenUrl = new URL('https://app.meandu.com/api/account/anonymoustoken')
const locationMarkers: LocationMarkerClaim[] = [
  {
    Type: 'qr',
    Token: 'https://app.meandu.com/qr?t=68ad1732720602d1051ffbce-demo',
  },
]

console.log(JSON.stringify(locationMarkers, null, 2))

const getAnonymousTokenResponse = await axios.get(getAnonymousTokenUrl.toString())
const anonymousToken: AnonymousTokenResponse = getAnonymousTokenResponse.data

const expiresAt = Date.now() + (anonymousToken.expires_in - 60) * 1000
const authCookie: MeAndUAuthCookie = {
  idToken: '',
  expiresAt: expiresAt,
  accessToken: anonymousToken.access_token,
  refreshToken: null,
  isAnonymous: false,
  authProvider: 'meandu',
}

console.log(anonymousToken)
console.log(expiresAt)
console.log(JSON.stringify(authCookie))

// const cookieString =
//   'authrestore_au=%7B%22accessToken%22%3A%22eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2OGI5MmJmMTcwNjY5MzEyMjY3YTI3Y2YiLCJleHAiOjE4MjAwMzc4NzMsImF1ZCI6ImFub255bW91cyJ9.PuD9zpm7lI_QrotFKYznLjZ9txOo8qJlB5iHdpAWYdY%22%2C%22refreshToken%22%3Anull%2C%22expiresIn%22%3A63072000%2C%22memberId%22%3A%2268b92bf170669312267a27cf%22%2C%22isAnonymous%22%3Atrue%7D; max-age=31536000; path=/; secure; samesite=strict; httponly'
//
// const splitCookies = cookieString.split(';').map((string) => string.trim())
// console.log(splitCookies)
