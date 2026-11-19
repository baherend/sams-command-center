# CRDC Researcher Portal (prototype)

Arabic, RTL researcher onboarding UI using React, Vite, TypeScript, Supabase Auth, and the `crdc` schema.

## Run locally

1. Copy `.env.example` to `.env.local`.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the project's URL and publishable/anon key. Never put a service-role key in browser code.
3. From this folder run `npm install`, then `npm run dev`.
4. Add `crdc` to Supabase API **Exposed schemas**; keep `private` unexposed. In Auth URL settings, allow `http://localhost:5173` as a redirect/site URL while developing. Email confirmation should remain enabled. The local Supabase configuration is set to require confirmation.

## Onboarding behavior

- Visitors can create an account or sign in with email and password.
- With email confirmation enabled, sign-up shows a confirmation message; after confirming, the researcher signs in and continues to the profile form.
- A signed-in user with no researcher row can create exactly one profile bound to their Auth user ID and Auth email.
- Egyptian researchers provide a national ID; foreign researchers provide nationality and passport number. Degree and specialty are captured separately from service requests.
- The profile form is insert-only. Researchers cannot change personal identity details after submission; corrections are an administrator workflow.
- The app reads degrees from `crdc.degrees` and writes to `crdc.researchers`; RLS remains the database authority.

This is an onboarding slice only. Request creation, files, account recovery, and staff pages are not included yet. It uses only synthetic/demo accounts during development.
