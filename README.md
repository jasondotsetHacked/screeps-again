# screeps-again

A fresh autonomous Screeps: World codebase focused on planning, world intelligence, forecasting, and self-sufficient colony operation.

## Project goals

- Play on the official Screeps persistent world.
- Analyze the live world before choosing a starting room.
- Run colonies autonomously after the initial spawn placement.
- Keep game runtime code and external analysis tools in one repository.
- Build planning logic as reusable pure TypeScript where practical.
- Keep credentials and deployment secrets out of git.

## Local setup

Requires Node.js 22 or newer.

```bash
npm install
cp .env.example .env
```

Create a Screeps API token and put it in your local `.env`:

```text
SCREEPS_API_TOKEN=your-token-here
```

Never commit the token. `.env` and world-analysis cache files are ignored by git.

## Commands

```bash
npm run check
npm run build
npm run deploy

npm run world:me
npm run world:shards
npm run world:room -- shard3 E12N34
npm run world:region -- shard3 E12N34 3
```

### Regional world analysis

`world:region` scans a square around a center room, reads ownership/status metadata, deep-inspects viable unowned standard rooms, and produces explainable starting-room scores.

The first scoring model considers:

- source count and source accessibility;
- terrain and swamp burden;
- approximate compact base footprint;
- terrain-aware travel from a suggested base area to sources/controller;
- nearby unowned expansion space;
- distance from highways;
- novice/respawn-area status;
- nearby observed player rooms and RCL.

The tool prints the strongest candidates and saves the complete result under `.world-cache/regions/`. The score is intentionally explainable and provisional; it will evolve as our world model improves.

See the project issues for the architecture and early roadmap.
