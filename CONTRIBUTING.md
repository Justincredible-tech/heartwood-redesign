# Contributing

Two people work on this repository. The aim is that anyone can open the history and see who did what, and why.

## Before you start

- Use your own GitHub account and make sure git commits as you:
  `git config user.name` and `git config user.email` (or your GitHub no-reply address, found under
  GitHub → Settings → Emails, if you'd rather keep your email private on this public repo).
- Set up the tools once: see "Quick start" in the [README](README.md).

## The loop

1. **Pick or open an issue** and assign it to yourself. One issue per piece of work, written so the other person
   understands it without asking: what is wrong or wanted, where, and how you'll know it's done.
2. **Branch from an up-to-date `main`:**
   ```bash
   git switch main && git pull
   git switch -c <your-name>/<short-task>      # e.g. sam/news-card-dates
   ```
3. **Change the readable source** (`source/`, `showcase/`, `tools/`), never build output. Keep the change about
   the one task. A refactor you noticed along the way gets its own issue.
4. **Check it:**
   ```bash
   cd tools
   npm run build
   python preview.py --port 8003
   # in another terminal:
   HEARTWOOD_PREVIEW=http://127.0.0.1:8003/ python test-delivery.py
   ```
   Then look at it in a browser at desktop and phone widths. Exercise anything you touched: navigation, leaves
   and their dialogs, the topic chips, member-group search, keyboard access and Escape, and reduced motion. Watch
   the console for errors.
5. **Commit** in small, readable steps (see below), push, and **open a pull request** into `main`.
6. **Merge** once the build and tests pass and the other person has had a chance to review. Delete the branch
   after merging.

`main` is protected: changes reach it through pull requests, so every change has a record of who made it,
who reviewed it, and why.

## Commit messages

- Short imperative subject, under about 60 characters: `Fix mobile dialog focus`, `Add Reunion dates to SITE`.
- A body when the why isn't obvious: what was wrong and what you changed.
- If an AI assistant wrote or substantially shaped the change, say so. Add a `Co-Authored-By:` trailer for it,
  so the history shows that too.

## Pull requests

Fill in the template. Reviewers should be able to answer from the PR alone:

- What changed, and why?
- How was it verified? Name the commands and browsers, and say what you did **not** check.
- For visual changes: before and after screenshots, desktop and phone.

Never claim something was tested if you didn't watch it pass.

## Things that need extra care

- `source/heartwood-site.html` holds hand-placed artwork geometry. Don't reformat it or rewrite its inline
  styles. The tests check that every artwork element and attribute survives the build.
- **Performance.** Profile before and after adding artwork, filters, `clip-path` on moving parts, or new
  animations. Note the numbers in the PR. Past measurements are in `review-evidence/`.
- **Paper grain.** Edit `--grain-fine`, then run `python tools/render-grain.py` and commit the new tiles. The
  tests fail until you do.
- **Secrets and client material.** Never commit credentials, client correspondence or internal planning
  documents. This repository is public.
