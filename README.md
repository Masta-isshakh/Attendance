# Attendance

Multi-tenant employee attendance app. Expo (React Native) + AWS Amplify Gen 2.

One admin owns one organization. Employees belong to exactly one organization and
can never see another's data. Attendance is geofenced, and check-in is verified
with a selfie matched against the employee's profile photo.

---

## Before you can invite real employees

**Amazon SES starts every account in the sandbox**, per region. While you are in
the sandbox you can only send email to addresses you have verified by hand, at a
maximum of 200 messages per 24 hours. Employees will not receive their
credentials until you fix this.

1. SES console (in `ap-south-1`) → **Account dashboard** → **Request production access**.
2. Verify the sending domain or the `no-reply@…` address you configured in
   `amplify/auth/resource.ts`.

Cognito's built-in email sender is capped at **50 emails per day for the entire
AWS account** and cannot be raised, so SES is required, not optional.

---

## First-time setup

### 1. Deploy the backend

```bash
npm install          # NOT `npm ci` — see "Known constraints"
npx ampx sandbox
```

This writes `amplify_outputs.json`. Until it runs, the app shows a
"backend not configured" screen instead of crashing.

### 2. Create an admin (manually, in the Cognito console)

Admins are never self-registered. There is no sign-up screen anywhere in the app.

In **Cognito → User pools → your pool → Users → Create user**:

| Field | Value |
| --- | --- |
| Username | **Not an email address.** e.g. `admin-acme` |
| Email | the admin's real address |
| Mark email as verified | **yes** |
| Password | set a permanent password |

Then open the user and **add them to the `ADMIN` group**. This step is what
routes them to the admin workspace — without it they land on an error screen.

> **Why the username cannot be an email:** the user pool uses `aliasAttributes:
> ['email']` so that employees sign in with a username while admins sign in with
> their email. Cognito refuses to create a user whose *username* looks like an
> email when email is an alias. The admin still types their **email address** on
> the sign-in screen — the alias resolves it.

### 3. Sign in as the admin

On first sign-in the admin is asked to name their organization and upload a logo.
That provisions the organization's Cognito groups and unlocks everything else:
employees, company location, geofence rule, attendance mode.

### 4. Build the mobile app

Background location and geofencing **do not work in Expo Go**. A development
build is required:

```bash
npm install -g eas-cli
eas login
eas build --profile development --platform android   # or ios
```

---

## Known constraints

These are platform limits, not bugs. Each one was verified against primary
documentation.

**`npm ci` does not work in this project.** `@aws-amplify/data-construct` ships
*bundled* copies of `@opentelemetry/core` and `zod`. npm never records bundled
dependencies in the lockfile, so `npm ci` always fails with
`EUSAGE / Missing: @opentelemetry/core@2.0.0 from lock file` — even after a
completely clean install. Use `npm install`.

**Cognito user pool settings are immutable.** `usernameAttributes`,
`aliasAttributes` and `usernameConfiguration` cannot be changed after the pool is
created; `UpdateUserPool` has no parameters for them. Editing them in
`amplify/backend.ts` and redeploying reports **success while changing nothing**.
Changing them for real means destroying the pool — and every user in it.

**"Inactive immediately" is not achievable.** OS geofence transitions are batched
and can arrive minutes late, and background tasks stop entirely when the user
force-kills the app. Android will not relaunch the app for location events; iOS
relaunches only for geofence transitions. Presence is therefore derived from
timestamped location pings with a staleness window (default 15 minutes,
configurable per organization), and the UI says "last seen inside 4 min ago"
rather than showing a fake live indicator. The app re-registers its background
tasks on every launch and foreground, which is the only way to recover from a
force-kill.

**Face matching is not liveness detection.** Amazon Rekognition `CompareFaces`
confirms the selfie is the same *person* as the profile photo. It cannot tell a
live face from a printed photo or a phone screen. AWS's Face Liveness component
does not ship for React Native. This raises the effort of buddy-punching but does
not prevent it — if attendance fraud matters commercially, budget for a
third-party liveness SDK.

**Web is not a supported runtime.** The web bundle compiles (Amplify Hosting
builds it) but renders a "open this on your phone" screen: browsers have no
background geolocation and no geofencing.

**Biometric data.** Profile photos and check-in selfies are biometric identifiers
under GDPR and laws like Illinois' BIPA. Get explicit consent, publish a
retention policy, and check local rules before deploying commercially.

---

## Architecture

```
amplify/
  auth/resource.ts         Cognito. Groups: ADMIN, EMPLOYEE
  data/resource.ts         Models + custom mutations + tenant isolation rules
  storage/resource.ts      Profile photos, selfies, org logos
  functions/
    org-provisioner/       Creates per-org Cognito groups, enrols the admin
    employee-manager/      AdminCreateUser / update / delete, presigned photo URLs
    face-verifier/         Rekognition CompareFaces (30s timeout, 1024MB)
  backend.ts               CDK escape hatch: username sign-in, no self-signup
src/
  lib/          amplify, geo maths, attendance rules, media, location, geofence task
  context/      SessionContext — auth state and role routing
  components/   UI kit, selfie camera, attendance row, language picker
  screens/      auth/ · admin/ · employee/
  navigation/   RootNavigator, AdminTabs, EmployeeTabs
  i18n/         English + French
```

### Tenant isolation

Every tenant-scoped record carries two Cognito group names:

- `memberGroup` = `org_<uuid>` — admin + all employees. Read access.
- `adminGroup` = `org_<uuid>_admin` — the owning admin only. Write access.

`allow.groupDefinedIn(field)` makes **AppSync** enforce this against the caller's
verified `cognito:groups` claim. It is never enforced by a client-side `filter`,
because `filter` is a client-supplied argument that an attacker can simply omit.

Splitting member and admin groups is what stops an employee from rewriting their
own organization's geofence or attendance mode.

> **Token refresh matters.** `cognito:groups` is baked into the JWT at issue
> time. After the provisioner adds a user to a new group, the token in hand does
> not contain it and the next write is denied. The app calls
> `fetchAuthSession({ forceRefresh: true })` immediately after provisioning.

### Attendance is written only by the server

Clients have **no write access to `AttendanceRecord`**. Check-in, check-out and
background presence pings all go through the `attendance-recorder` function,
which independently:

- recomputes the distance from the organization's stored coordinates (the
  device's own opinion of whether it is inside is never trusted),
- re-runs Rekognition `CompareFaces` against the employee's stored profile
  photo, resolving both keys server-side, and
- re-derives ACTIVE/INACTIVE from the geofence rule.

Without this, the geofence and face checks would be advisory: anyone able to
call the API could mark themselves present from home.

### The presence rules

All of it lives in one pure function, `derivePresence` in `src/lib/geo.ts`:

- **Geofence rule ON** — after check-in, presence follows location. Leaving the
  radius deactivates; returning reactivates, with no further taps.
- **Geofence rule OFF** — checking in pins the employee active for the whole
  shift; only an explicit check-out ends it.
- **Automatic mode** — arriving checks the employee in and leaving checks them
  out, with no selfie. Native only.

---

## Commands

```bash
npx tsc --noEmit                    # typecheck the app
npx tsc --noEmit -p amplify/tsconfig.json   # typecheck the backend
npx expo export --platform android  # verify the native bundle
npx expo export --platform web      # what Amplify Hosting builds
npx ampx sandbox                    # deploy/refresh the backend
```
