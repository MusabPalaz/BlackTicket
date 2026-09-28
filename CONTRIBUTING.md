# Contributing to Black Ticket

Thanks for your interest. Bug reports, fixes and improvements are welcome.

## Before you start

- **Open an issue first** for anything larger than a small fix, so the approach
  can be agreed before you spend time on it.
- **Security problems** should not be reported in a public issue. Contact the
  maintainer privately through the links on their GitHub profile.

## Contributor License Agreement

Every pull request needs agreement to the [Contributor License Agreement](CLA.md).
Tick the box in the pull request template. You keep the copyright in your work;
the agreement lets the project be offered under AGPL-3.0 and, separately, under
a commercial licence. Pull requests without the box ticked cannot be merged.

## Development setup

Requirements: Node.js 22+, PostgreSQL 16+.

```bash
npm install
cp .env.example .env      # fill in the values
npm run db:migrate
npm run db:seed
npm run dev
```

## Before opening a pull request

```bash
npm run typecheck
npm run test
npm run lint
```

- Keep changes focused; one concern per pull request.
- Database changes go in a new Prisma migration. Never edit a migration that has
  already been released: installations apply them in order and cannot undo them.
- Follow the style of the surrounding code, including its comment density.

## Conventions

- **Everything is in English:** interface text, code comments and documentation.
- Permissions are enforced on the server. The web app hides what a role cannot
  do, but the API is the authority and re-checks every request.
