---
description: How the documentation in this repository is written and kept current.
---

# Documentation conventions

> **Layer:** Internal · **Audience:** engineering, AI agents working in the repo

1. **The code outranks every document** on the question of what exists. Write
   from the code, and name the file or command that proves a claim so it can be
   re-checked rather than believed.
2. **Say what is not built.** "Planned", "partial" and "not proven live" are
   labels, not admissions. A plan is never evidence that something exists.
3. **Change the document in the same commit as the code.** If a change makes a
   page wrong, fix the page, or mark the passage out of date, in that commit.
4. **One current answer.** Status lives in [docs/status](status/README.md),
   findings in `audit/`, decisions in the [Decision log](decisions/README.md).
   Don't start a second page that answers the same question.
5. **Header.** Each page starts with front matter holding a one-line
   `description`, then a `Layer` and `Audience` line. Use GitBook hint blocks
   for warnings and dated notes.
6. **List every page** in [SUMMARY.md](SUMMARY.md). Use relative links, and
   check that they resolve.
7. **Retire, don't hoard.** When a document is superseded, delete it and say
   where it went. Git keeps it; the `pre-cleanup` tag holds everything removed
   in the November 2026 cleanup.
