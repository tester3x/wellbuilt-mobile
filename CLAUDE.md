# WellBuilt Project

## First Steps - Read These Files
1. `.claude/project-summary.md` - Architecture overview, key files, concepts
2. `.claude/barrel-list.md` - Pending bugs and future improvements
3. `.claude/daily-summary.md` - Today's work (all sessions for current day)
4. `.claude/session-log/` - Past daily summaries if needed (named by date: 2026-01-12.md)

## Session Workflow
- Each session: update daily-summary.md before wrapping up
- New day: move yesterday's daily-summary.md to session-log/{date}.md, start fresh
- After completing a significant task: suggest updating notes and wrapping up

## Context Management (IMPORTANT)
- **Proactively warn** when context is getting full before losing track of earlier work
- Say things like: "Context is getting heavy - good time to wrap up and start fresh"
- Warning signs to flag: long sessions with many edits, asking about things already discussed
- If user notices repetition or confusion about prior work, acknowledge it and suggest new chat
- **ALWAYS** update daily-summary.md before ending a session so the next chat knows what happened

## Critical Rules
- **VBA code location:** `C:\dev\WellBuilt\VBA` - This is the ONLY place to edit VBA (.bas, .cls files)
- **This repo (C:\WellBuiltMobile):** React Native/Expo app only - JavaScript/TypeScript code
- **NEVER** create or edit VBA files in this mobile repo
- **Always deploy Cloud Functions** after making changes: `npx firebase deploy --only functions`

## Quick Reference
- Firebase is the bridge between VBA (Excel) and the mobile app
- VBA writes to `outgoing/`, app reads it
- App writes to `incoming/`, VBA processes and deletes
- Performance data in `performance/{wellName}/rows/{timestamp}`
- Production data in `production/{wellKey}/{yyyy-mm-dd}` — stores AFR, window-averaged, and overnight bbls/day
- Main screen uses **window-averaged** bbls/day (from Cloud Function `windowBblsDay`), NOT AFR
- AFR is **only** shown on Prod tab in Manager screen
- Easter egg: tap bbls/day to toggle to overnight formula (shows " ON" suffix at end)
