import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* PWA */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#111111" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Word Territory" />
        <link rel="apple-touch-icon" href="/icon.svg" />

        {/* Favicon */}
        <link rel="icon" type="image/svg+xml" href="/icon.svg" />

        {/* Open Graph — static defaults; index.js overrides per-page */}
        <meta property="og:site_name" content="Word Territory" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://wordterritory.com/og-image.svg" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content="https://wordterritory.com/og-image.svg" />

        {/* Preconnect for performance */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
