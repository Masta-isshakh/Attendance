# Build Prompt: Multi-Tenant Attendance App (Expo SDK 57 + AWS Amplify Gen 2)

> Paste everything below this line into Copilot as a single task.

---

You are a senior React Native + AWS engineer. Build a production-ready, multi-tenant employee attendance application in this existing repository. Follow this specification exactly. Do not skip, simplify, or substitute any requirement. Where this document states a platform constraint, treat it as verified fact — do not "fix" it or work around it with an approach it explicitly forbids.

## Confirmed product decisions (already settled — do not revisit)

1. **Target is a native iOS/Android app** built with EAS. The web export must keep compiling for the existing Amplify Hosting pipeline, but web is not a supported runtime (see §1.5).
2. **Employees get a temporary password and must set their own on first sign-in** (see §1.11). Never email a permanent plaintext password.
3. **Admins are created manually in the Cognito console** with a non-email username plus their email as an alias, so they still sign in by typing their email (see §1.3).
4. **Tenant isolation is enforced by per-organization Cognito groups**, never by client-side filtering (see §3, §1.13).

## 0. Current repository state (verified — do not re-derive)

- Repo root is the folder containing `package.json`. Expo SDK `~57.0.7`, React `19.2.3`, React Native `0.86.0`, TypeScript `~5.9.3`.
- `App.tsx` is still the blank Expo template. There is no router, no screens, no source code yet.
- Already installed: `aws-amplify@^6.19.0`, `@aws-amplify/ui-react-native@^2.7.4`, `@aws-amplify/react-native@^1.3.3`, `@react-native-community/netinfo@12.0.1`, `@react-native-async-storage/async-storage@2.2.0`, `react-native-safe-area-context@~5.7.0`, `react-native-get-random-values@~1.11.0`, `react-native-url-polyfill@^4.0.0`, `react-native-web@^0.21.2`, `react-dom@19.2.3`.
- Dev deps: `@aws-amplify/backend@^1.23.0`, `@aws-amplify/backend-cli@^1.8.3`, `aws-cdk-lib@^2.244.0`, `constructs@^10.7.1`.
- `amplify/` contains only the default template: `backend.ts`, `auth/resource.ts`, `data/resource.ts`. There is **no storage resource and no functions**.
- **A Cognito user pool is ALREADY DEPLOYED** (sandbox stack, `ap-south-1`, pool `ap-south-1_6IeeI14gP`) with `username_attributes: ["email"]`. `amplify_outputs.json` exists locally and is gitignored.
- `amplify.yml` at the repo root drives Amplify Hosting and currently builds **web only** (`npx expo export --platform web` → `dist/`). It has **no `backend:` phase**.
- **`npm ci` does not work in this project** — `@aws-amplify/data-construct` ships bundled copies of `@opentelemetry/core` and `zod` that npm never records in the lockfile. Always use `npm install`. Never change the build spec to `npm ci`.

## 1. Hard platform constraints — read before writing any code

These are verified against primary AWS/Expo documentation and the installed packages. Violating any of them produces code that compiles but does not work.

### 1.1 Cognito user pool settings are immutable

`UsernameAttributes`, `AliasAttributes` and `UsernameConfiguration` (case sensitivity) **cannot be changed after the pool is created**. `UpdateUserPool` has no parameters for them. CloudFormation labels them "Update requires: No interruption", which is misleading — editing `amplify/auth/resource.ts` and redeploying reports **success while silently changing nothing**.

The existing pool has `UsernameAttributes: ["email"]`, which forces every user to sign in with an email. That directly contradicts the requirement that employees sign in with a username. **The pool must be destroyed and recreated.**

**Step 1 of your work is therefore:**
```bash
npx ampx sandbox delete --yes
```
Then apply the config in §2 **before** the next deploy. Never attempt an in-place update.

### 1.2 `defineAuth` has no username option

`loginWith` accepts only `email`, `phone`, `webAuthn`, `externalProviders`. There is **no `loginWith: { username: true }`** — do not search for one, do not invent one. The Amplify docs state plainly: *"Amplify Auth does not support signing in with only username and password."*

Username sign-in is only reachable through the L1 CDK escape hatch in §2.

### 1.3 With email as an alias, usernames may not look like emails

Once `aliasAttributes: ['email']` is set, **Cognito rejects any username that matches an email format**. This breaks the stated requirement *"for the admin, the username should be an email"* — it is not possible.

Resolution (implement this): admins are created in the Cognito console with a **non-email username** (e.g. `admin-acmecorp`), with the `email` attribute set to their real address and `email_verified` ticked to `true`. Because email is an alias, the admin can then still **type their email address on the sign-in screen** and it will work. The user-facing requirement is satisfied; only the stored username differs.

Employee usernames must be validated client-side and server-side to reject anything email-shaped.

### 1.4 Self sign-up is currently enabled and must be disabled

`defineAuth` has no flag for this and Amplify hardcodes `selfSignUpEnabled: true`. Right now anyone with the public client id can create an account. Fix with the escape hatch in §2: `adminCreateUserConfig = { allowAdminCreateUserOnly: true }`.

### 1.5 Target platform: native iOS/Android. Web must still compile.

**The delivery target is a native mobile app.** `expo-location` on web implements only `getCurrentPositionAsync` / `watchPositionAsync` — **background location and geofencing do not exist on web**, so the product only works natively.

However, Amplify Hosting currently builds this repo with `npx expo export --platform web`, and that build must keep succeeding or the deployment pipeline breaks. Therefore:

- Build and test every feature for **iOS and Android**.
- The **web export must still compile without errors**, but web is not a supported runtime. On web, render a simple "Please open this app on your phone" screen instead of the app shell.
- Guard any native-only module behind `Platform.OS !== 'web'` so the web bundle never crashes at import time.
- Do **not** invest in web feature parity, and do not delete the web export from `amplify.yml`.

### 1.6 Expo Go cannot run this app

Background location and geofencing require a **development build**. Add `expo-dev-client`, set `ios.bundleIdentifier` and `android.package` in `app.json`, create `eas.json`, and build with EAS. State this in the README — testing in Expo Go will fail.

### 1.7 "Immediately inactive" is not achievable

OS geofence transitions are **batched and delayed by minutes**, and background tasks stop entirely when the user force-kills the app. Android will not relaunch for location events; iOS relaunches only for geofence transitions.

Implement it this way instead — do not promise "immediate":
- Status is **server-derived from timestamped location pings**, never a device-pushed boolean.
- Store `lastSeenInsideAt` on the attendance record; treat the employee as inside only if a ping arrived within a staleness window (default 15 minutes, configurable).
- On every app foreground/launch, call `Location.hasStartedLocationUpdatesAsync(TASK)` and `Location.hasStartedGeofencingAsync(TASK)` and re-register if false; also force one immediate position check.
- Surface honest UI copy: "last seen inside 3 minutes ago", not a fake live indicator.

### 1.8 There is no face recognition in Expo

`expo-face-detector` **was removed after SDK 50 and does not exist in SDK 57** — do not import it or add it to `package.json`. `expo-camera`'s `CameraView` does barcodes only.

Face matching must be **server-side via AWS Rekognition `CompareFaces`** (available in `ap-south-1`). Also note face *detection* ≠ face *recognition*; you need the latter.

### 1.9 There is no liveness detection for React Native

`FaceLivenessDetector` ships for React web, Swift, and Android native only — **not React Native**. Do not promise anti-spoofing. `CompareFaces` alone **can be defeated by holding up a printed photo or a phone screen**. Document this limitation prominently in the README and add a `TODO` where a liveness provider would integrate.

### 1.10 Email constraints

- Cognito's built-in email sender is capped at **50 emails/day for the entire AWS account**, non-adjustable. An SES-backed sender is **mandatory**, not optional.
- **Amazon SES starts every account in the sandbox**, per region: you can only send to pre-verified addresses, max 200/day. Production access must be requested before real employees can be invited. Put this in a "Before you can invite real employees" block at the top of the README.
- `AdminCreateUser`'s `DesiredDeliveryMediums` **defaults to SMS**. Always pass `['EMAIL']` explicitly and set `email_verified: 'true'`, or no email is sent at all.

### 1.11 Cognito can never email a permanent plaintext password

The built-in invitation email can only carry a **temporary** password, and the user lands in `FORCE_CHANGE_PASSWORD`.

**This is the chosen and required behaviour — implement exactly this, and do not email permanent plaintext passwords:**

1. `employeeProvisioner` calls `AdminCreateUser` with a temporary password and `DesiredDeliveryMediums: ['EMAIL']`.
2. Cognito emails the employee their **username and temporary password**.
3. On first sign-in, `signIn` returns the next step `CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED`.
4. The app must handle that step with a dedicated "Set your password" screen (new password + confirm, matching validation) calling `confirmSignIn`.
5. Only after that does the employee reach the first-login selfie flow.

The password field on the admin's create-employee form therefore sets the **temporary** password. Label it clearly in the UI as "Temporary password — the employee will be asked to change it on first sign-in".

### 1.12 Data auth mode must change

The scaffolded `amplify/data/resource.ts` sets `defaultAuthorizationMode: 'identityPool'`, which makes **every owner-based and group-based rule impossible**. Replace the file entirely: set `defaultAuthorizationMode: 'userPool'`, delete the `Todo` model, delete every `allow.guest()`.

### 1.13 Client-side filtering is not security

AppSync `filter` is a client-supplied argument. An employee of org B can call `client.models.Employee.list()` without a filter and read org A's data. **Never** implement tenant scoping as a client-side filter, and never put `allow.authenticated()` on a tenant-scoped model.

### 1.14 S3 tenant isolation

`{entity_id}` resolves to the caller's Identity Pool `identityId`, not an org id. Use `profile-photos/{entity_id}/*` with `allow.entity('identity').to(['read','write','delete'])` for self-access. Cross-tenant admin reads and the face-verification Lambda must go through **backend function access**, not client-side paths.

### 1.15 Lambda timeout

`defineFunction` defaults to a **3-second** timeout. A Rekognition round-trip plus S3 read plus cold start exceeds it. The face-verification function needs `timeoutSeconds: 30, memoryMB: 1024`.

## 2. Backend: auth

Rewrite `amplify/auth/resource.ts` and `amplify/backend.ts`. Everything here must be in place **before the first deploy**.

`amplify/auth/resource.ts`:
```ts
import { defineAuth } from '@aws-amplify/backend';

export const auth = defineAuth({
  loginWith: { email: true }, // required by Gen 2; overridden below
  senders: {
    email: { fromEmail: 'no-reply@YOUR_VERIFIED_DOMAIN', fromName: 'Attendance' },
  },
  groups: ['ADMIN', 'EMPLOYEE'],
});
```

`amplify/backend.ts` — capture the return value (the template currently discards it):
```ts
const backend = defineBackend({ auth, data, storage, /* functions */ });

const { cfnUserPool } = backend.auth.resources.cfnResources;
cfnUserPool.usernameAttributes = [];                 // frees `username` as the sign-in id
cfnUserPool.aliasAttributes = ['email'];             // admins can still type their email
cfnUserPool.adminCreateUserConfig = { allowAdminCreateUserOnly: true }; // kills self sign-up
```

Implement these auth flows with `aws-amplify/auth` v6 APIs — `signIn`, `confirmSignIn`, `signOut`, `resetPassword`, `confirmResetPassword`, `fetchAuthSession`, `getCurrentUser`:

- **Sign-in screen only.** No sign-up screen, no "create account" link, anywhere in the app.
- Employees sign in with **username** + password. Admins sign in with their **email** (works via the alias).
- **Reset password**, exactly these steps as separate screens:
  1. Enter email → `resetPassword`.
  2. **One** field for the emailed verification code → Verify.
  3. Two fields: new password + confirm password (must match, with inline validation) → `confirmResetPassword`.
  4. Auto-redirect to sign-in.
- After sign-in, read `cognito:groups` from the session and route to the **admin workspace** or the **employee workspace**.

## 3. Backend: data and tenant isolation

Replace `amplify/data/resource.ts` completely.

**Isolation strategy (use this, not the alternatives):** one Cognito group per organization, named `org_<uuid>`, with `allow.groupDefinedIn('organizationId')` on every tenant-scoped model. The `organizationId` field's value **is** the group name.

Models:
- **Organization** — `name`, `logoKey`, `latitude`, `longitude`, `radiusMeters` (default 100), `geofenceRuleEnabled` (boolean), `attendanceMode` (`MANUAL` | `AUTOMATIC`), `adminUserId`, `organizationId`.
- **Employee** — `employeeId` (unique), `username`, `email`, `phoneNumber`, `profilePhotoKey`, `status` (`ACTIVE` | `INACTIVE`), `hasCompletedFirstLogin`, `organizationId`.
- **AttendanceRecord** — `employeeId`, `organizationId`, `checkInAt`, `checkOutAt`, `checkInLat`, `checkInLng`, `checkOutLat`, `checkOutLng`, `method` (`MANUAL` | `AUTOMATIC`), `faceMatchConfidence`, `lastSeenInsideAt`.

Add secondary indexes for: list employees by organization; list attendance by employee sorted by date; list attendance by organization and date range.

**Uniqueness:** Cognito usernames are globally unique within the pool, which satisfies "unique across all organizations" for usernames. For any other cross-item uniqueness, use a guard table with a DynamoDB conditional write — AppSync/DynamoDB cannot enforce it natively.

**Org provisioning:** Cognito groups cannot be declared per-organization at build time. Create a custom mutation `createOrganization` backed by `a.handler.function(orgProvisioner)` that (1) generates the org id, (2) calls `CreateGroup`, (3) calls `AdminAddUserToGroup` for the admin, (4) writes the Organization record.

**Token-refresh trap:** `cognito:groups` is baked into the JWT at issue time. After the Lambda adds the admin to the new group, the client's existing token does **not** contain it and every query will be denied. Immediately after `createOrganization` returns, call `fetchAuthSession({ forceRefresh: true })` **before** navigating into the workspace. Do the same after an employee is provisioned.

## 4. Backend: storage

Create `amplify/storage/resource.ts`:
```ts
export const storage = defineStorage({
  name: 'attendance-media',
  access: (allow) => ({
    'profile-photos/{entity_id}/*': [allow.entity('identity').to(['read', 'write', 'delete'])],
    'org-logos/*': [allow.authenticated.to(['read'])],
  }),
});
```
Grant the face-verification and admin functions access via backend function access, not client paths.

## 5. Backend: functions

1. **`orgProvisioner`** — creates the Cognito group and the Organization record (§3).
2. **`employeeProvisioner`** — `AdminCreateUser` with `DesiredDeliveryMediums: ['EMAIL']` and `email_verified: 'true'`, adds the user to the org group and the `EMPLOYEE` group, writes the Employee record, and sends credentials per §1.11.
3. **`faceVerifier`** — `defineFunction({ timeoutSeconds: 30, memoryMB: 1024 })`. Reads the stored profile photo and the submitted selfie from S3, calls Rekognition `CompareFaces` with `SimilarityThreshold: 90`, returns `{ matched, similarity }`. Exposed as a custom mutation.

Grant each function only the IAM actions it needs (`cognito-idp:AdminCreateUser`, `cognito-idp:CreateGroup`, `rekognition:CompareFaces`, `ses:SendEmail`, scoped S3 reads).

## 6. Frontend

**Navigation:** two workspaces routed by Cognito group.

**Admin workspace:**
- First login: if no Organization exists for this admin → forced setup flow: name the organization, upload a logo. Only then proceed.
- Employee management: create, update, delete. Creation form collects **username, email, phone number, password**, with both creation modes (invite with temporary password / direct credentials).
- Company location: set and change (map picker + manual lat/lng), and set the radius.
- Toggle the geofence rule on/off.
- Choose attendance mode: manual or automatic.
- Roster showing each employee's **profile photo**, active/inactive status, and last-seen time.
- Full attendance history with per-employee and date-range filtering.

**Employee workspace:**
- **First login only:** a notice reading "You must take a selfie of yourself" → front camera opens (`expo-camera` `CameraView` with `facing="front"` and `useCameraPermissions`) → take selfie → Continue. That photo becomes the profile picture. Never ask again (`hasCompletedFirstLogin`).
- Home: greeting with the employee's photo and a welcome message naming their organization.
- **Bottom bar: Home icon left, large Check In button centre, Profile icon right.**
- Profile tab: attendance history, logout, language switcher, settings.

**Manual check-in flow:**
1. Tap Check In → loading spinner.
2. Verify the device is within `radiusMeters` of the company location (Haversine).
3. If outside → clear error, stop. If inside → front camera opens.
4. Selfie → upload → `faceVerifier` → compare against the profile photo.
5. On match → checked in, status `ACTIVE`, centre button becomes **Check Out**.
6. Check Out repeats the identical location + face verification.

**Geofence state machine — implement exactly:**
- Active means the last location ping was within `radiusMeters` and is not stale.
- **Rule ENABLED:** after first check-in, leaving the radius sets `INACTIVE` (as soon as the OS reports it — see §1.7); re-entering sets `ACTIVE` again automatically.
- **Rule DISABLED:** after the first check-in inside the radius, the employee **stays ACTIVE regardless of location** and only becomes `INACTIVE` on an explicit check-out.
- **AUTOMATIC mode** (native only): entering the radius with location enabled checks in and marks active with no taps; leaving marks inactive.

**i18n:** `i18next` + `react-i18next` + `expo-localization`. No hardcoded user-facing strings — every string goes through translation keys. Ship English and French.

## 7. Required packages

Install with `npx expo install` so versions match SDK 57: `expo-camera`, `expo-location`, `expo-task-manager`, `expo-dev-client`, `expo-image-manipulator`, `expo-localization`, `expo-router` (or `@react-navigation/*`), `i18next`, `react-i18next`, `@aws-sdk/client-rekognition`, `@aws-sdk/client-cognito-identity-provider`, `@aws-sdk/client-sesv2`.

Add the required `app.json` plugin config and permission strings for camera, foreground location, and background location (`NSCameraUsageDescription`, `NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription`, `ACCESS_BACKGROUND_LOCATION`, Android foreground-service config).

## 8. Verification loop — mandatory

After implementing everything, do **not** report completion. Instead:

1. Write `CHECKLIST.md` enumerating **every** requirement in this document as an individually checkable item, grouped by section, each marked ✅ implemented / ❌ missing with the file and line implementing it.
2. Run and fix until all are clean:
   - `npx tsc --noEmit` — zero TypeScript errors.
   - `npx expo export --platform web` — must succeed.
   - `npm install` — no dependency resolution errors. (Never `npm ci`.)
   - `npx ampx sandbox` — backend deploys successfully.
3. Capture every error, fix it, then **re-run the entire checklist from the top**. Repeat until every item is ✅ and all four commands pass.
4. Explicitly verify these easily-missed details: no sign-up UI anywhere; selfie prompt fires only on first login; the centre button toggles Check In ↔ Check Out; both geofence-rule branches behave differently; both attendance modes work; language switching persists; admin cannot see another org's data (test with two orgs).
5. Report honestly. If something could not be implemented because of a constraint in §1, say so plainly and explain what was built instead. Do not claim a feature works when it is stubbed.

**Definition of done:** all checklist items ✅, all four commands green, tenant isolation verified with two organizations, and every §1 limitation documented in the README.
