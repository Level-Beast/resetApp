# Ease

Offline rest app: custom breathing programs, a blank-screen stillness timer, a daily heat log, and a consistency grid.
Plain HTML/CSS/JS. No build step, no dependencies.

## Put it on GitHub Pages
1. Create a repo and push these files to the root of the `main` branch.
2. Repo Settings > Pages > Deploy from a branch > `main` / root.
3. Open `https://<you>.github.io/<repo>/` on your phone.

## Install as an app
- Android (Chrome): menu > Install app (not "Add to Home screen" shortcut).
- iPhone (Safari): Share > Add to Home Screen.
Open it once online; after that it works with no internet.

## Updating
Edit files, then bump `VERSION` in `sw.js` so installed copies refresh.
Data lives in the phone's localStorage. Use Settings > Save backup now and then.
