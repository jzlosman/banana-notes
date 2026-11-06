# Banana Tasks

Banana Tasks is a separately installed, local-first macOS companion for personal to-dos. It shares Banana Notes’ theme catalog and floating-window interaction, not its notes library or preferences. No account or server is required for local tasks.

## Build and open

Requires macOS 14+, Xcode command-line tools, and Node.js 22+.

```sh
npm ci --ignore-scripts
npm run build:tasks
open "build/Banana Tasks.app"
```

The build is a universal Apple silicon/Intel app, locally ad-hoc signed. It is not a notarized public release. Tasks has its own bundle identity, version source, data directory, and preferences. Building it does not install or launch Banana Notes or Banana Viewer.

Use **Control–Option–T** or the menu-bar icon to summon the floating window. Pin keeps it visible; otherwise it dismisses after focus leaves. Dismissal waits for pending changes to save. A failed save keeps the window open and explains the problem.

## Age, effort, and attention

These are different measurements:

- **Age:** time since the task was captured. Editing, working, or changing priority does not reset it.
- **Effort:** time explicitly recorded with a work timer or a manual entry. An open window or a scheduled calendar block does not count as work.
- **Ripeness:** an attention signal based on priority and active time since progress. Higher-priority tasks ripen sooner. Waiting, snoozed, and archived intervals do not count, even after resuming. Progress cools attention without rewriting age.

Tasks never expire. Complete one when it is finished, or compost it when you no longer want to do it. Compost is recoverable, not permanent deletion. Tags belong to individual tasks and can organize unrelated tasks into useful groups.

Appearance is independent of Banana Notes. The shared theme catalog remains available; motion and sound are optional, and sound starts off. System Reduce Motion is respected. There is no points requirement or streak penalty.

## Optional phone capture with Todoist

[Todoist](https://www.todoist.com/downloads/android) provides an Android app and a hosted service. Its [API](https://developer.todoist.com/api/v1/) is free to use subject to account-plan limits. Todoist is a proprietary service; it is optional, not the local app’s backend.

Connect with a personal API token and select one capture project. The Mac connects directly to Todoist. There is no Banana Tasks server, Google Cloud project, public callback endpoint, or webhook server to operate. Credentials belong in macOS Keychain, not task documents.

Connecting and choosing a capture project explicitly enables imports and linked-task completion updates. Local work and saving remain available while a remote request is pending or offline. The bridge imports captures from the selected project. Linked tasks retain their source identity so repeat imports do not duplicate them. Local-created tasks are not automatically uploaded, and task history, effort records, and visual state remain local. Completing or reopening an imported task can update its Todoist source; failed writebacks remain retryable. A different connected account cannot complete tasks linked to the old account.

This is not a general-purpose mirror of every Todoist field. Phone captures arrive when the Mac is online and sync runs. Disconnecting Todoist does not remove local tasks.

## Optional calendar time blocks

Calendar access uses macOS EventKit and requires explicit permission. Google calendars already connected in macOS Internet Accounts can be used through that system connection; Banana Tasks does not implement a separate Google login.

A calendar block is time reserved to work on a task, not a deadline and not a completed work session. Creating a block requires a writable calendar and an explicit action. Existing appointments are not moved or deleted. Local task use does not require Calendar permission.

## Agent handoff

Prepare and copy a brief for one task, including its context, desired result, and permission boundaries. This version prepares the handoff; it does not silently send task data to an AI service or claim that an agent has executed the work.

## Data and safety

The native app owns its task document under `~/Library/Application Support/Banana Tasks/`. Versioned structured task data is separate from appearance preferences and credentials. Store writes are bounded, atomic, and revision-checked; unreadable startup data is not silently replaced by an empty list. The app never reads the Banana Notes library or Nudge’s task/credential files.

The browser preview at `http://127.0.0.1:4177/tasks.html` uses an isolated preview store. Native integrations are unavailable there rather than simulated as connected. Explicit demonstration data is synthetic and does not populate the normal native app.

## Development and verification

```sh
npm run typecheck
npm test
npm run build:web
npm run test:tasks:native
npm run build:tasks
npm run test:tasks:webkit
```

For interactive verification, create a disposable, separately identified app copy:

```sh
PROFILE="$(bash scripts/prepare-tasks-verification-profile.sh)"
"$PROFILE/Banana Tasks Verification.app/Contents/MacOS/Banana Tasks"
```

The copy is bound to its temporary profile even when reopened without environment variables. Its Todoist, Calendar, and system clipboard capabilities are replaced with unavailable/inert verification adapters; it cannot connect to real accounts or read appointments. Quit the copy before removing its temporary directory. Do not launch the normal bundle for automated verification.

The domain lives in `web/src/tasks/domain/`; application use cases and effect contracts in `web/src/tasks/application/`; native/browser adapters in `web/src/tasks/adapters/`; the interface in `web/src/tasks/ui/`. `web/src/tasks/main.ts` composes them. The independent Mac composition and adapters live in `tasks/native/`.

Tests use synthetic task documents, temporary directories, and substitute network/calendar/credential ports. UI verification must use the isolated Tasks verification profile, never personal notes, tasks, Calendar events, or credentials. Live Todoist and Calendar behavior requires authorized account access; passing mocked tests is not a claim of live-account verification.
