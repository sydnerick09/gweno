# Project Reading Instructions

Before making any code changes, read the relevant files and understand the existing implementation.

## Required Workflow
1. Read this file first.
2. Read the relevant files for the requested feature.
3. Read `apps.md` for application rules.
4. Read `auth.md` before changing authentication, users, accounts, roles, or permissions.
5. Read `language.md` before writing or changing code.
6. Read `html.md` and `css.md` before changing the interface.
7. Read `mig.md` before changing existing data structures, storage, plans, or major functionality.

## Change Rules
- Do not rewrite working functionality unnecessarily.
- Do not remove existing features unless explicitly requested.
- Make the smallest reliable change necessary.
- Reuse existing functions, components, data structures, and configuration.
- Do not duplicate existing logic.
- Search the codebase before creating a new implementation.
- Preserve compatibility with existing user data.

## Before Completing Work
Verify:
- The requested feature works.
- Existing functionality still works.
- No duplicate logic was created.
- The interface remains responsive.
- Data persists correctly after refresh.
- Related validation and permissions recognize the change.

When the request involves subscription plans, inspect:
- Plan configuration
- Hamburger or navigation menu
- Admin Panel
- Change Plan controls
- User dashboard
- Task access
- Plan validation
- Storage and persistence
- Pricing or subscription display
