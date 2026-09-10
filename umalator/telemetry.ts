// Analytics removed in this fork.
//
// Upstream sends click and usage events to a PostHog project belonging to the
// original author. Keeping it in a fork means your visitors' events go to
// someone else's dashboard, and ad blockers make it spam the console with
// ERR_BLOCKED_BY_CLIENT on every action.
//
// These are kept as no-ops so the ~10 postEvent call sites elsewhere don't need
// touching, and so merging upstream changes stays easy. Dropping the posthog-js
// import also takes a sizeable chunk out of the bundle.

export function initTelemetry() {
}

export function postEvent(_event: string, _obj: any) {
}
