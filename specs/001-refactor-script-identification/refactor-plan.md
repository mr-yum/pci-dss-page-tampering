Refactor plan
================

We want to refactor this system to be more modular and robust. We will concentrate on two interleaving concerns:

1. Updating the script inventories to separate how scripts are identified vs how their content is authorised. See below for example update to the inventory schema to support. Key difference is that each script will have separate identifyWith & authoriseWith properties which can each be a name matcher, a content matcher or a hashes based matcher. This will enable us to use the same logic for matching inline scripts and external scripts without hardcoded identification code. It would also enable us to have modularised, testable and extendable selection of matchers.

2. Refactor the flow for comparing so that the comparison service returns an array of meaningful and typed comparison results, that later can be handled by handlers.  Each comparison results should have the full context required for the handler to act on it. Example comparison results: UnknownScriptFound with the relevant script info and target. KnownScriptWithUnauthorisedContentFound with the relevant script info, including content, and target and the and the authorisation matcher that it failed.

Example inventory schema:
```json
{
  "target": {
    "inventory": {
      "type": "inventory",
      "url": "https://staging.meandu.app/pcidsscompliance",
      "workflow": "2.0_uat-workflow.json"
    },
    "detection": {
      "type": "detection",
      "url": "https://meandu.app/pcidsscompliance?number=10",
      "workflow": "2.0_production-workflow.json"
    }
  },
  "alerts": {
    "inventory": {
      "newScriptIdentified": {
        "destination": "#_pci-page-tampering-alerts"
      },
      "newHeaderIdentified": {
        "destination": "#_pci-page-tampering-alerts"
      }
    },
    "detection": {
      "newScriptDetected": {
        "destination": "#_pci-page-tampering-alerts"
      },
      "scriptMismatchDetected": {
        "destination": "#_pci-page-tampering-alerts"
      },
      "newHeaderDetected": {
        "destination": "#_pci-page-tampering-alerts"
      }
    }
  },
  "scripts": [
    {
      "identifyWith": {
        "nameMatcher": "^https:\\/\\/www\\.recaptcha\\.net\\/recaptcha\\/enterprise\\/webworker\\.js\\?.*$"
      },
      "authoriseWith": {
        "contentMatcher": ".*"
      },
      "authorisationInfo": {
        "description": "(re)captcha bot prevention",
        "authorised": true,
        "date": "2025-08-25T00:00:00.000Z"
      }
    },
    {
      "identifyWith": {
        "nameMatcher": "^https:\\/\\/hcaptcha\\.com\\/1\\/api\\.js\\?.*$"
      },
      "authoriseWith": {
        "hashes": [
          {
            "timestamp": "2025-08-26T05:58:41.265Z",
            "hash": {
              "value": "2d70875557ec2cd30d5dd986b695b517b54e0a0e33e42f8a7c7c2cd593e08b40"
            }
          },
          {
            "timestamp": "2025-09-12T04:36:07.656Z",
            "hash": {
              "value": "0c6bd30b4df581d97757ec269fcfd81ec1ae5757fc6b885bb2d9e924b85aa798"
            }
          }
        ]
      },
      "authorisationInfo": {
        "description": "(re)captcha bot prevention",
        "authorised": true,
        "date": "2025-08-25T00:00:00.000Z"
      }
    },
    {
      "identifyWith": {
        "nameMatcher": "^https:\\/\\/connect\\.facebook\\.net\\/signals\\/config\\/\\d+\\?.*$"
      },
      "authoriseWith": {
        "contentMatcher": ".*"
      },
      "authorisationInfo": {
        "description": "Facebook Connect part of Facebook Pixel used by our customers to track analytics to their electronic menus",
        "authorised": true,
        "date": "2025-08-25T00:00:00.000Z"
      }
    },
    {
      "identifyWith": {
        "contentMatcher": "https:\\/\\/connect\\.facebook\\.net\\/en_US\\/fbevents\\.js"
      },
      "authoriseWith": {
        "hashes": [
          {
            "timestamp": "2025-09-11T00:00:00.000Z",
            "hash": {
              "value": "e43fcd9fb68765ae9e6b8cb616522da03bfb87c6069b67fc9961869495a03e2c"
            }
          }
        ]
      },
      "authorisationInfo": {
        "description": "Facebook Pixel used by our customers to track analytics to their electronic menus",
        "authorised": true,
        "date": "2025-08-25T00:00:00.000Z"
      }
    },
    {
      "identifyWith": {
        "contentMatcher": "a.src='\\/cdn-cgi\\/challenge-platform\\/scripts\\/jsd\\/main.js'"
      },
      "authoriseWith": {
        "contentMatcher": "a.src='\\/cdn-cgi\\/challenge-platform\\/scripts\\/jsd\\/main.js'"
      },
      "authorisationInfo": {
        "description": "Cloudflare Bot Mode script",
        "authorised": true,
        "date": "2025-09-10T00:00:00.000Z"
      }
    }
  ],
  "headers": [
    {
      "nameMatcher": "^content-security-policy$",
      "contentMatcher": "script-src self 'unsafe-inline' 'unsafe-eval' https:\\/\\/cdn\\.mryum\\.com https:\\/\\/static\\.meandu\\.app https:\\/\\/connect\\.facebook\\.net https:\\/\\/www\\.google-analytics\\.com https:\\/\\/www\\.googletagmanager\\.com https:\\/\\/api\\.paystack\\.co https:\\/\\/api2\\.amplitude\\.com https:\\/\\/cdn\\.amplitude\\.com https:\\/\\/challenges\\.cloudflare\\.com https:\\/\\/js\\.paystack\\.co https:\\/\\/js\\.stripe\\.com https:\\/\\/maps\\.googleapis\\.com https:\\/\\/\\*\\.eonx\\.com https:\\/\\/cdn\\.eonx\\.com https:\\/\\/dev\\.meandu\\.app https:\\/\\/mryum\\.local",
      "authorisationInfo": {
        "description": "NO_DESCRIPTION",
        "authorised": false,
        "date": "2025-10-14T06:08:35.100Z"
      }
    },
    {
      "nameMatcher": "^content-security-policy$",
      "contentMatcher": "img-src 'self' https:\\/\\/js\\.stripe\\.com https:\\/\\/q\\.stripe\\.com https:\\/\\/qr\\.stripe\\.com https:\\/\\/b\\.stripecdn\\.com https:\\/\\/files\\.stripe\\.com https:\\/\\/stripe-camo\\.global\\.ssl\\.fastly\\.net https:\\/\\/d1wqzb5bdbcre6\\.cloudfront\\.net",
      "authorisationInfo": {
        "description": "NO_DESCRIPTION",
        "authorised": false,
        "date": "2025-10-03T01:18:10.274Z"
      }
    }
  ]
}
```
