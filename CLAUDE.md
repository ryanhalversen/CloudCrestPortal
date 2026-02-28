# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CloudCrestPortal is a Salesforce DX project building an Experience Cloud (community) portal for project/sprint management and story tracking. It uses Lightning Web Components (LWC) for frontend, Apex for backend, the Case standard object for stories, and a custom Sprint__c object for project/sprint data.

## Commands

```bash
npm run lint                  # ESLint on all Aura/LWC JS files
npm run test:unit             # Run Jest-based LWC unit tests
npm run test:unit:watch       # Watch mode for tests
npm run test:unit:coverage    # Tests with coverage report
npm run prettier              # Format all files (Apex, HTML, JS, XML, CSS, JSON, YAML)
npm run prettier:verify       # Check formatting without writing
```

Salesforce CLI commands for org operations:
```bash
sf org create scratch -f config/project-scratch-def.json -a <alias>
sf project deploy start       # Push metadata to org
sf project retrieve start     # Pull metadata from org
sf apex run test              # Run Apex tests in org
```

## Architecture

### Salesforce Metadata Package Layout

All source lives under `force-app/main/default/`:

- **`lwc/`** — Lightning Web Components (frontend)
- **`classes/`** — Apex controllers, each paired 1:1 with a `*Test` class
- **`objects/Case/`** — Stories are stored as Cases; many custom fields and list views
- **`objects/Sprint__c/`** — Custom object with 60+ fields representing projects/sprints
- **`messageChannels/`** — Two Lightning Message Channels for inter-component communication: `StorySubmitted` and `ProjectSelected`
- **`experiences/`** — Two Experience Cloud sites: `CloudCrest_HelpDesk1` and `Customer_PM_and_Self_Serve1`

### LWC Components and Their Apex Controllers

| LWC Component | Apex Controller |
|---|---|
| `submitAStory` | `SubmitAStoryController` |
| `storyBoard` | `StoryBoardController` |
| `storyFeed`, `storyFeedHub`, `storyFeedList`, `storyFeedPost`, `storyFeedComposer`, `storyFeedSidebar` | `StoryFeedController` |
| `sprintPlanner` | `SprintPlannerController` |
| `projectScorecard` | `ProjectScorecardController` |
| `execOverview` | `ExecOverviewController` |
| `eodTimeRetro` | `EodTimeRetroController` |
| `actionItemParser` | `ActionItemParserController` |
| `portalNav` | (navigation only, no Apex controller) |

### Inter-Component Communication Pattern

Components communicate via Lightning Message Service (LMS) using two message channels:
- `ProjectSelected` — broadcast when a user selects a project/sprint
- `StorySubmitted` — broadcast when a new story is submitted

### API Version

Salesforce API **v61.0** (set in `sfdx-project.json`).

### Deployment Notes

`manifest/projectScorecard-manifest.xml` exists for targeted deployments. `.forceignore` excludes `actionItemParser`, `Experiences`, and `Networks` from default push/pull operations.
