# PMA Expo connection — November 8, 2026

Organization: `stellar-intelligent-software-developers` (STELLAR INTELLIGENT SOFTWARE DEVELOPERS).

Active project: `property-management-assistant`.
Project ID: `03efdc88-5ec0-4c61-a504-4c1a3d1cd45f`.
Dashboard: https://expo.dev/accounts/stellar-intelligent-software-developers/projects/property-management-assistant

The GitHub repository `Aproposchpt2/PROPERTY-MANAGEMENT-ASSISTANT` is connected in Expo. The saved base directory is `/mobile`. `mobile/app.json` now declares the organization owner and project ID. No secret credentials were added to source control.

An initial empty project was accidentally created with the duplicated slug `property-management-assistantproperty-management-assistant` during onboarding. It has no repository connection or builds and is not the active project. It was left undeleted; use only the canonical project above.

Validation: mobile TypeScript check passed and Expo's resolved public configuration contains the expected owner, slug and project ID. `CI=1 expo lint` could not initialize because there is no ESLint configuration and the setup request failed with an HTTP proxy timeout. Existing test results from this session: backend 187/187, mobile 16/16. iOS, Android and web exports compiled before this configuration-only change; signed native builds have not been created.

Remaining: Apple Developer enrollment/signing, Android Firebase notification configuration, client display name, backend deployment and real-device acceptance testing. No paid plan, public store submission, or production backend deployment was initiated. CLI authentication is separate from the browser session and has not been configured.

Private delivery to client organizations should use an appropriate Apple distribution method, such as Custom Apps. The current `internal` build profile is for registered-device testing; it is not a completed client release process.
