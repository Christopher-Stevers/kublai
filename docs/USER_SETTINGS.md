# User settings

`/dashboard/account/settings` is available from Settings in the desktop user menu and mobile menu's user section. It inherits the authenticated account routes' access rules, independent of dashboard tab access.

Controls reuse the existing device preferences: system/light/dark theme, preferred email app, and material-list sorting. Changes save immediately on this device. They do not change organization settings or persist across other devices. The existing account page retains profile, installation and subscription features; its appearance/email controls read and write the same preferences.

Verified: production build and TypeScript; browser navigation through both menus; applied theme; email and sort persistence after reload; offline preference updates; mobile light/dark and desktop screenshots.
