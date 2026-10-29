# Bundled application fonts

Inter and Space Grotesk, normal variable weights 400-700, Latin subset, downloaded from the Google Fonts distribution. Their SIL Open Font License notices are included beside the files. Keep these notices with redistributed assets.

RootLayout loads these checked-in WOFF2 files through next/font/local, preserving the existing CSS variables and Tailwind typography. Production builds and browsers do not request Google Fonts. This avoids the Next 15.5.28 Google loader URL-extension parsing failure reported in CI. No framework or dependency change is required.

Font selection request: https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=Space+Grotesk:wght@400..700&display=swap

- inter-latin-variable.woff2: 48,256 bytes; SHA-256 `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62`. Source: https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2
- space-grotesk-latin-variable.woff2: 22,288 bytes; SHA-256 `0640890476fc1198ab4de571fb658de443c4d85b66466ec09534a8737ab1ce9d`. Source: https://fonts.gstatic.com/s/spacegrotesk/v22/V8mDoQDjQSkFtoMM3T6r8E7mPbF4Cw.woff2

Validation: production build must succeed and emitted CSS must contain both local font families, weights 400 700, display swap and same-origin font URLs. Do not restore a Google build-time fetch or runtime stylesheet to work around CI.

Verified locally: npm run ci (lint, TypeScript, 249 unit tests), production Next 15.5.28 build, and emitted-file SHA-256 checks passed. Compiled CSS retains both font variables, normal weights 400 700 and display swap, with no Google font URLs. CI must verify this change on its Linux runner.
