import crypto from "node:crypto";
import process from "node:process";
import puppeteer from "puppeteer";

if (process.argv.length < 3) {
  console.error("Usage: node index.js <url>");
  process.exit(1);
}

const targetUrl = process.argv[2];

function hashBuffer(buf, algo = "sha256") {
  return crypto.createHash(algo).update(buf).digest("base64");
}
function hashString(str, algo = "sha256") {
  return hashBuffer(Buffer.from(str, "utf8"), algo);
}

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Capture JS responses as they load (works across origins; not limited by CORS)
  const scriptBodies = new Map(); // finalURL -> Buffer
  page.on("response", async (res) => {
    try {
      const ct = (res.headers()["content-type"] || "").toLowerCase();
      const isScriptType =
        res.request().resourceType() === "script" ||
        ct.includes("javascript") ||
        ct.includes("ecmascript") ||
        ct.endsWith("/js");

      if (!isScriptType) return;

      const url = res.url();
      const buf = await res.buffer();
      scriptBodies.set(url, buf);
    } catch {
      // ignore body read errors
    }
  });

  // Load page and wait for network to settle a bit
  await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 90_000 });

  // Give late dynamic imports a brief moment (tweak if needed)
  await page.waitForTimeout(1500);

  // Enumerate <script> elements present in the DOM
  const domScripts = await page.evaluate(() => {
    return Array.from(document.scripts).map((s, i) => ({
      index: i,
      src: s.src || null,
      inline: !s.src,
      type: s.type || "text/javascript",
      async: !!s.async,
      defer: !!s.defer,
      nomodule: !!s.noModule,
      nonce: s.nonce || null,
      referrerPolicy: s.referrerPolicy || null,
      // Only bring back content for inline scripts
      content: s.src ? null : s.textContent || "",
    }));
  });

  // Build results for inline and external scripts found in the DOM
  const inlineResults = domScripts
    .filter((s) => s.inline)
    .map((s) => {
      const sha256 = hashString(s.content, "sha256");
      const sha384 = hashString(s.content, "sha384");
      return {
        kind: "inline",
        index: s.index,
        type: s.type,
        nonce: s.nonce,
        length: Buffer.byteLength(s.content, "utf8"),
        sha256,
        sha384,
        integrity_sha256: `sha256-${sha256}`,
        integrity_sha384: `sha384-${sha384}`,
        snippet: s.content.slice(0, 120).replace(/\s+/g, " "),
      };
    });

  // External scripts referenced in DOM (may or may not have loaded successfully)
  const externalDomRefs = domScripts
    .filter((s) => !s.inline && s.src)
    .map((s) => s.src);

  const externalDomResults = externalDomRefs.map((src) => {
    const body = scriptBodies.get(src);
    if (body) {
      const sha256 = hashBuffer(body, "sha256");
      const sha384 = hashBuffer(body, "sha384");
      return {
        kind: "external-dom",
        url: src,
        length: body.length,
        sha256,
        sha384,
        integrity_sha256: `sha256-${sha256}`,
        integrity_sha384: `sha384-${sha384}`,
      };
    }
    // Not fetched (blocked, failed, or loaded after our wait)
    return {
      kind: "external-dom",
      url: src,
      length: null,
      sha256: null,
      sha384: null,
      integrity_sha256: null,
      integrity_sha384: null,
      note: "No response body captured",
    };
  });

  // Also include scripts that were fetched as JS but may not correspond to a <script src> (e.g., dynamic import())
  const fetchedOnly = [];
  for (const [url, body] of scriptBodies.entries()) {
    if (!externalDomRefs.includes(url)) {
      const sha256 = hashBuffer(body, "sha256");
      const sha384 = hashBuffer(body, "sha384");
      fetchedOnly.push({
        kind: "external-fetched",
        url,
        length: body.length,
        sha256,
        sha384,
        integrity_sha256: `sha256-${sha256}`,
        integrity_sha384: `sha384-${sha384}`,
      });
    }
  }

  const output = {
    url: targetUrl,
    generated_at: new Date().toISOString(),
    summary: {
      inline_dom_count: inlineResults.length,
      external_dom_count: externalDomResults.length,
      external_fetched_only_count: fetchedOnly.length,
    },
    inline_dom_scripts: inlineResults,
    external_dom_scripts: externalDomResults,
    external_fetched_only_scripts: fetchedOnly,
  };

  console.log(JSON.stringify(output, null, 2));

  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
