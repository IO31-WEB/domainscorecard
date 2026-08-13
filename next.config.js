/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 15 moved this out of `experimental` — if your installed version
  // still expects `experimental.serverComponentsExternalPackages`, move it
  // there instead. Without this, Next tries to bundle the Chromium binary
  // into the function and the PDF route will fail at runtime.
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium', 'pdf-parse', 'xlsx'],
}

module.exports = nextConfig
