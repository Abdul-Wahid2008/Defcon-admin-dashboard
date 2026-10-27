# docs/club-inputs — sanitised inputs from the club (no passwords, tokens, private keys, public terminal URLs)

Drop files here exactly as named. Claude Code reads this folder in W2 and W8.
- `template.compose.yml` (from the club's HAMDEFCON repo)
- `scoreboard.sample.json` (a real file from `/data/scoreboard.json`, mid-game if possible, plus one from the freeze window if available)
- `attack.sample.json` (if used)
- `ctf.json` / EnoEngine team+service config (team ids, names, service ids) — remove any addresses you consider private
- `roster.sample.csv` (registration export, 3 sample rows is enough)
- `checker-verdicts.md` (how the club's enochecker3 checkers report OK/MUMBLE/OFFLINE/INTERNAL_ERROR; any extra statuses)
