# Migration and Safe Change Rules

## Before Changing Existing Features
- Inspect the current implementation first.
- Identify all files affected by the change.
- Preserve existing functionality.
- Reuse existing data structures.
- Avoid unnecessary rewrites.
- Avoid creating duplicate systems.

## Data Compatibility
When modifying user data:
- Preserve existing user records.
- Preserve unrelated user properties.
- Provide safe defaults for new properties.
- Ensure older data continues to work.
- Do not reset existing accounts.

## Plan Changes
When adding or modifying a subscription plan:
1. Check whether the plan already exists.
2. Reuse the existing plan configuration.
3. Add the plan to missing validation or selection interfaces.
4. Do not create duplicate plan objects.
5. Preserve existing plan assignments.
6. Ensure plan changes persist after refresh.

## Safe Update Pattern
- Read the current object.
- Preserve existing properties.
- Change only the required property.
- Save the updated object.

Never replace an entire object if only one property needs to be changed.
