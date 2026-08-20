// Stand-in for a vendor script injected after load, by page script.
window.fixtureVendor = window.fixtureVendor || {}
window.fixtureVendor.dynamic = { loadedAt: Date.now() }
