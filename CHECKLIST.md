# Implementation checklist

Every requirement, with the file that implements it. Verified by typecheck and
bundle, **not** by running the app on a device — see "Not yet verified".

## Multi-tenancy

| Requirement | Status | Where |
| --- | --- | --- |
| One admin owns one organization | ✅ | `org-provisioner/handler.ts` rejects a second org for the same admin |
| Admin created manually in Cognito console | ✅ | Runbook in `README.md`; `adminCreateUserConfig.allowAdminCreateUserOnly` in `backend.ts` |
| Admin names org + uploads logo on first login | ✅ | `screens/admin/OrganizationSetupScreen.tsx` |
| Employees belong to their admin's org | ✅ | `employee-manager/handler.ts` adds them to `org_<id>` |
| No data overlap between organizations | ✅ | `allow.groupDefinedIn('adminGroup'/'memberGroup')` in `data/resource.ts` |
| Employee usernames unique across all orgs | ✅ | Cognito usernames are globally unique within the pool |
| Each employee has a unique id | ✅ | `Employee.id` + `userId` (Cognito `sub`) |

## Authentication

| Requirement | Status | Where |
| --- | --- | --- |
| No sign-up screen anywhere | ✅ | `RootNavigator.tsx` has only SignIn/Reset/NewPassword; self-signup disabled in `backend.ts` |
| Employee signs in with username | ✅ | `cfnUserPool.usernameAttributes = []` |
| Admin signs in with email | ✅ | `cfnUserPool.aliasAttributes = ['email']` |
| Reset: email → code → verify → new+confirm → sign-in | ✅ | `screens/auth/ResetPasswordScreen.tsx`, three discrete steps |
| One field for the verification code | ✅ | Same file, `step === 'CODE'` |
| Two fields for the new password | ✅ | Same file, `step === 'PASSWORD'` |
| Auto-redirect to sign-in after reset | ✅ | `onDone` → `setRoute('SIGN_IN')` with a notice |
| Temporary password → forced change on first sign-in | ✅ | `SignInScreen` handles `CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED` → `NewPasswordScreen` |
| Two workspaces routed by role | ✅ | `RootNavigator.tsx` |

## Admin

| Requirement | Status | Where |
| --- | --- | --- |
| Create employees (username, email, phone, password) | ✅ | `EmployeeFormScreen.tsx` → `createEmployeeAccount` |
| Credentials emailed to the employee | ✅ | `AdminCreateUser` with `DesiredDeliveryMediums: ['EMAIL']` |
| Update employees | ✅ | `EmployeeFormScreen.tsx` → `updateEmployeeAccount` |
| Delete employees | ✅ | `EmployeesScreen.tsx` → `deleteEmployeeAccount` + cascade of attendance rows |
| Set / change company location | ✅ | `AdminSettingsScreen.tsx`, incl. "use my current location" |
| Toggle the 100 m rule | ✅ | `AdminSettingsScreen.tsx` → `geofenceRuleEnabled` |
| Choose manual / automatic | ✅ | `AdminSettingsScreen.tsx` → `attendanceMode` |
| See active vs inactive employees | ✅ | `AdminOverviewScreen.tsx`, `EmployeesScreen.tsx` |
| See employees **with their photos** | ✅ | `EmployeesScreen.tsx` → `getEmployeePhotoUrl` presigned URLs |
| Track all check-ins / check-outs / history | ✅ | `AdminAttendanceScreen.tsx` with today/week/all filters |

## Employee

| Requirement | Status | Where |
| --- | --- | --- |
| First login only: "You must take a selfie" | ✅ | `SelfieOnboardingScreen.tsx`, gated on `hasCompletedFirstLogin` |
| Front camera opens on any phone | ✅ | `SelfieCamera.tsx` — `CameraView facing="front"` |
| First photo becomes the profile picture | ✅ | `SelfieOnboardingScreen.tsx` → `profilePhotoKey` |
| Never asked again | ✅ | `needsSelfieOnboarding` in `SessionContext.tsx` |
| Greeted with photo + welcome | ✅ | `EmployeeHomeScreen.tsx` |
| Bottom bar: Home left, big Check In centre, Profile right | ✅ | `navigation/EmployeeTabs.tsx` |
| Button flips to Check Out once checked in | ✅ | Same file, driven by `employee.isCheckedIn` |
| Profile: history, logout, language, settings | ✅ | `EmployeeProfileScreen.tsx` + `LanguagePicker.tsx` |

## Check-in / check-out

| Requirement | Status | Where |
| --- | --- | --- |
| Spinner while location is verified | ✅ | `CheckInScreen.tsx` phase `LOCATING` |
| Blocked when outside the radius | ✅ | `checkRange` — reports the actual distance |
| Selfie camera opens when inside | ✅ | Phase `CAMERA` |
| Face matched against the profile photo | ✅ | `face-verifier` → Rekognition `CompareFaces`, threshold 90 |
| On match → checked in + ACTIVE | ✅ | `performCheckIn` |
| Check-out repeats face verification | ✅ | Same flow with `mode='OUT'` |

## Geofence rules

| Requirement | Status | Where |
| --- | --- | --- |
| Rule ON: leaving → INACTIVE, returning → ACTIVE | ✅ | `derivePresence` in `lib/geo.ts` |
| Rule OFF: stays ACTIVE until explicit check-out | ✅ | Same function, early return |
| AUTOMATIC: arrive → in, leave → out, no taps | ✅ | `lib/geofenceTask.ts` |
| Automatic is native-only | ✅ | Guarded by `supportsBackgroundLocation` |

## Quality gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` (app) | ✅ zero errors |
| `npx tsc --noEmit -p amplify/tsconfig.json` | ✅ zero errors |
| `npx expo export --platform android` | ✅ builds (4.4 MB Hermes bundle) |
| `npx expo export --platform web` | ✅ builds |
| `npm install` | ✅ no resolution errors |
| Backend deploys | ✅ pool `ap-south-1_Yz9wgGcLg` with `username_attributes: []` |

## Defects found by adversarial review and fixed

62 review agents raised claims; each was independently verified against the
code. Confirmed and fixed:

- **Any employee could become an admin** — `provisionOrganization` was
  `allow.authenticated()`. Now `allow.group('ADMIN')` plus a handler-side check,
  and the org id is always server-generated.
- **Any admin could delete another org's employees** — update/delete verified
  only the caller's org, never the target's. Now `AdminListGroupsForUser`
  confirms the target is in that org, with an identical error message for
  "not found" so it cannot be used to enumerate users.
- **Any admin could read another org's photos** — `getEmployeePhotoUrl` presigned
  a client-supplied S3 key. It now takes a username and resolves the key from the
  record.
- **Face check was trivially defeatable** — `verifyFace` took both keys from the
  client, so passing the same key twice scored 100%. The reference photo is now
  resolved server-side from the caller's own record.
- **Check-in was mathematically impossible** — the accuracy tolerance required
  `distance <= 0` whenever GPS accuracy ≥ radius. Rewritten with a bounded
  tolerance, plus separate exit hysteresis so jitter cannot flap presence.
- **Employees could rewrite their own tenancy fields** — field-level auth now
  restricts `organizationId`, `memberGroup`, `adminGroup`, `userId`, `username`
  and `email` to admins.
- **Filtered lists silently lost rows** — `list({filter, limit})` filters *after*
  the page, so open shifts and employee lookups often returned nothing. All
  filtered reads now paginate through `nextToken`.
- **An employee who left could never check out** — check-out was gated on being
  inside the radius. Only check-in is now gated.
- **A failed profile write locked the employee out forever** — Amplify returns
  `{data: null, errors}` rather than throwing; that path now surfaces an error.
- **A brief network drop signed the user out** — `refresh()` treated any error as
  signed-out. Only missing credentials do now.
- **Silent false success** — settings save and employee create reported success
  even when the write failed. Both check `errors` now, and a failed employee
  record rolls back the Cognito account.
- Plus: stuck "checking location…", unhandled camera rejections, `skipProcessing`
  degrading Android images for face matching, hardcoded English in the delete
  dialog, missing back button on the final reset step, orphaned attendance rows,
  and a UTC/local `dayKey` mismatch that misreported hours near midnight.

## Not yet verified

- **The app has never been run on a device.** Typecheck and bundle both pass, but
  no screen has been rendered, no check-in performed, no Rekognition call made.
- **The backend needs a redeploy** — the schema changed after the last
  `ampx sandbox` (field-level auth, new mutation signatures). Run
  `npx ampx sandbox` before testing.
- The `getEmployeePhotoUrl` / `verifyFace` DynamoDB lookups use `Scan` with a
  filter. Correct, and fine at per-organization scale, but should become a Query
  against the `organizationId`+`username` index before large deployments.
- **Server-side attendance is now in place** but has not been exercised against a
  real device. `attendance-recorder` writes DynamoDB items directly (rather than
  going back through AppSync), so the item shape — model fields plus `id`,
  `createdAt`, `updatedAt`, `__typename` — is the thing most worth checking on
  the first real check-in.
- Liveness detection is still absent, so a printed photo can defeat the face
  check. No React Native option exists from AWS; this needs a third-party SDK.
- SES is still in the sandbox, so invitation emails only reach verified
  addresses.
