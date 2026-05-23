import { Html, Head, Main, NextScript } from "next/document";

const SITE_URL = "https://word-territory1.onrender.com";
const OG_IMAGE = `${SITE_URL}/og-image.svg`;

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
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <link rel="icon" type="image/svg+xml" href="/icon.svg" />

        {/* Open Graph */}
        <meta property="og:site_name" content="Word Territory" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Word Territory — Strategy meets vocabulary" />
        <meta property="og:description" content="A spatial strategy word game. Use words to capture territory. Free Daily Challenge — no account needed." />
        <meta property="og:url" content={SITE_URL} />
        <meta property="og:image" content={OG_IMAGE} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Word Territory — Strategy meets vocabulary" />
        <meta name="twitter:description" content="Use words to capture territory. Free Daily Challenge." />
        <meta name="twitter:image" content={OG_IMAGE} />

        {/* For AI crawlers: description of what this page is */}
        <meta name="description" content="Word Territory is a free browser strategy game where players use words to capture territory on a 7x7 board, similar to Go but with words. Features Daily Challenge, Normal and Strong bot modes. Play at word-territory1.onrender.com" />

        <link rel="preconnect" href="https://fonts.googleapis.com" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
