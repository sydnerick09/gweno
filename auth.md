# Authentication and User Account Rules

## General Rules
Do not break:
- Login
- Logout
- User sessions
- User profile access
- Role permissions
- Admin permissions
- User plan access

## User Roles
The application may support:
- Client
- Agent
- Regional Agent
- Administrator

Do not change role permissions unless explicitly requested.

## Subscription Plans
When an administrator changes a user's plan:
1. Validate the selected plan.
2. Save the new plan.
3. Update the user's stored data.
4. Update the active or displayed user state.
5. Ensure the plan persists after page refresh.
6. Apply the new plan's permissions and access rules.

## Valid Plans
The system must recognize:
- Basic
- Premium
- Premium Pro
- Exclusive Plan

Do not reject Exclusive Plan as an invalid subscription.

## Persistence
Use the application's existing persistence system. If the project uses localStorage:
- Continue using the existing localStorage structure.
- Do not introduce a database unless explicitly requested.
- Do not overwrite unrelated user information.
- Update only necessary user fields.
- Preserve existing users and account data.
