# Habit Garden – Entwicklung

Technische Dokumentation zu Habit Garden: Aufbau, Build, Auslieferung, Lizenzen. Die Beschreibung der App für Nutzerinnen und Nutzer steht im [README](../README.md).

Habit Garden ist eine local-first Website. Alle Daten liegen ausschließlich im Browser (IndexedDB). Es gibt kein Konto, keine Datenbank auf dem Server und keine Telemetrie; Export und Import (JSON) sind der einzige Transferweg.

Stand: Phase 1 (Grundgerüst) mit dem Garten-Redesign vom 12.10.2026 und Phase 2 vom 13.10.2026 (Wiederholungen mit Folgeinstanz, Unteraufgaben, Schnellsyntax, Abendkarte) sowie Phase 3 Teil 1 (PLANUNG mit Bereichs-Chips, Projekten, Liste, Inbox und Projektseite; Projekt, Status und Verlauf im Aufgaben-Sheet). Kanban, Matrix, Suche und ICS-Export folgen in Phase 3 Teil 2; WISSEN ist als Screen mit Leerzustand vorhanden und folgt in Phase 4.

## Garten und Personen

Auf Wunsch des Product Owners weicht HEUTE seit dem 12.10.2026 bewusst von der zurückhaltenden Gestaltung des Feinkonzepts (Calm Technology) ab:

- Hero: Datum, Begrüßung nach Tageszeit, Fortschritt „x von y heute gegossen“ und eine Landschaft, deren Himmel sich nach der Tageszeit färbt; die Sonne wandert, nachts steht ein Mond.
- Wiese: Jeder aktive Bereich ist ein Beet mit Schild (Blume und Name). Jede Routine steht darin als Pflanze in ihrer aktuellen Stufe und trägt ein Namensschild; ein Bereich ohne Routine zeigt einen Samen. Die Pflanzen wiegen sanft im Wind.
- Routinen-Karten: Pflanze im Bogenfenster, Stufe, „Noch n Tage bis …“ (`nextStage` in `services/growth.ts`), Tage in Folge, „Heute gießen“ und eine 12-Wochen-Heatmap.
- Personen: Name, Wunschrhythmus (wöchentlich, alle zwei Wochen, monatlich, vierteljährlich), Notiz und Kontaktverlauf mit optionaler Art (Anruf, Nachricht, Treffen). „Melde dich bei“ schlägt bis zu drei Personen vor, deren Rhythmus am weitesten überschritten ist. In der Wiese fliegt jede Person als Schmetterling über dem Beet „Beziehungen“: im Rhythmus in ihrer Farbe, überfällig blass am Boden. Fehlt dieser Bereich, erscheinen die Schmetterlinge in einem eigenen Beet „Menschen“. Verwaltung über „Alle Personen“ (`screens/sheets/people.ts`).
- Bewegung: Wiegen, Flattern und ziehende Wolken laufen nur in CSS und stehen still bei „Bewegung reduzieren“ im System oder bei „Animationen: reduziert“ in den Einstellungen.
- Datenbank: Version 2 ergänzt die Tabellen `contacts` und `contactLogs`. Exporte enthalten sie; ältere Exportdateien ohne diese Tabellen bleiben importierbar.
- Technische Kennungen bleiben aus Kompatibilitätsgründen beim früheren Arbeitsnamen: IndexedDB-Name `olife`, Exportformat `"format": "olife"`, Meta-Namen `olife-build` und `olife-base`. Die Exportdatei heißt `habit-garden-backup-JJJJ-MM-TT.json`.

## Voraussetzungen

- Node.js ≥ 22 und npm (nur für den Build)
- PHP ≥ 8.1 (Entwicklung mit dem eingebauten Server, Betrieb mit Apache)

## Build

```sh
npm install
npm run build
```

`npm run build` führt nacheinander aus:

| Schritt | Wirkung |
|---|---|
| `clean` | entfernt `public/app/` und `build/` |
| `vendor` | kopiert `dexie.mjs` und `purify.mjs` nach `public/vendor/`, bündelt markdown-it einmalig mit esbuild zu einer ESM-Datei (markdown-it 14 liefert kein Browser-ESM ohne Bundler; dies ist der einzige Bundler-Einsatz und betrifft nur `vendor/`), kopiert `InterVariable.woff2` und die OFL-Lizenz |
| `sprite` | erzeugt `public/assets/icons.svg` aus einer festen Liste von Lucide-Icons |
| `tsc` | kompiliert `src/` zu nativen ES-Modulen in `public/app/` |
| `stamp` | schreibt einen Hash über alle auszuliefernden Dateien nach `public/app/build.txt` |

Weitere Befehle:

- `npm test`: Unit-Tests (`node:test`, Zeitzone Europe/Berlin) für Wachstum, Wiederholung, Datum, Sortierschlüssel, Router, Basispfad und Kontakte
- `npm run check`: Prüft, dass kein `any`, kein `@ts-ignore`, keine Ausrufezeichen in Oberflächentexten und keine deutschen Texte außerhalb von `src/i18n/de.ts` vorkommen
- `npm run watch`: `tsc --watch` für die Entwicklung
- `npm run build:pages`: `npm run build` und danach die statische Fassung für GitHub Pages in `dist/pages/` (`scripts/pages.mjs`, siehe [Deployment auf GitHub Pages](#deployment-auf-github-pages))

## Lokale Entwicklung

```sh
npm run build
npm run serve        # php -S localhost:8080 -t public
npm run watch        # in einem zweiten Terminal
```

Der eingebaute PHP-Server liefert für jeden Pfad ohne Datei `index.php` aus; `.htaccess` wird dabei nicht ausgewertet. Die Seite ist dann unter `http://localhost:8080/` erreichbar. `localhost` gilt als sicherer Kontext, sodass IndexedDB, `crypto.randomUUID()` und Benachrichtigungen verfügbar sind; ein Zugriff über eine LAN-IP ohne TLS ist kein sicherer Kontext.

## Deployment auf Apache

1. `npm ci && npm run build`
2. Den Inhalt von `public/` in das Document Root kopieren (einschließlich `.htaccess`).
3. Benötigt werden PHP, `mod_rewrite`, `mod_headers` und `AllowOverride All` (oder die Regeln aus `.htaccess` in der vHost-Konfiguration). Die Seite muss über HTTPS ausgeliefert werden.

`index.php` setzt ausschließlich Sicherheits-Header und den Build-Stempel:

- Content-Security-Policy nach Spezifikation, ergänzt um den sha256-Hash der Import Map. Die Import Map ist das einzige Inline-Skript und enthält keinen ausführbaren Code. Ohne diesen Hash blockieren Browser sie, und die Seite startet nicht (abgestimmte Abweichung von F §2.5).
- `Strict-Transport-Security`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy`, `Cache-Control: no-cache`.

Caching (abgestimmte Abweichung von F §4.3): Der Build-Stempel wird über alle Ausgabedateien gebildet und als `?v=` an Stylesheets, `main.js`, die Bibliotheken und das Icon-Sprite gehängt. `.htaccess` liefert nur Anfragen mit gültigem `?v=` als `immutable` aus; alle übrigen Dateien, etwa die per relativem Import geladenen App-Module, werden bei jedem Laden neu validiert. So erreichen Updates auch wiederkehrende Browser.

## Deployment auf GitHub Pages

Zusätzlich lässt sich Habit Garden als statische Projektseite auf GitHub Pages betreiben, etwa unter `https://daimpad.github.io/habit-garden/`. Die Apache-Auslieferung bleibt davon unberührt.

- Workflow: `.github/workflows/static.yml` (Pages-Quelle „GitHub Actions“) läuft bei jedem Push auf `main` und manuell. Er führt `npm ci`, `npm test` und `npm run build:pages` aus und veröffentlicht `dist/pages/`.
- Inhalt von `dist/pages/`: `app/`, `vendor/`, `styles/`, `assets/` und `licenses.txt` aus `public/` (ohne `index.php` und `.htaccess`), dazu `index.html`, eine identische `404.html` und `.nojekyll`. Das HTML wird aus `public/index.php` abgeleitet und hat denselben Aufbau.
- Basispfad: `BASE_PATH` (Standard `/`) wird allen URLs im HTML vorangestellt, jeweils mit `?v=<Build-Stempel>`, und steht in `<meta name="olife-base">`. Der Workflow übernimmt ihn aus `base_path` von `actions/configure-pages`, für dieses Repository `/habit-garden/`. Lokal: `BASE_PATH=/habit-garden/ npm run build:pages`. Die Routen bleiben intern `/heute`, `/aufgabe/:id` usw. Nur in der Adresszeile, in Links, beim Icon-Sprite und bei `licenses.txt` steht der Basispfad davor. `index.php` setzt `/`.
- Rückfall über `404.html`: Pages kennt keine Rewrite-Regeln und beantwortet unbekannte Pfade mit `404.html`. Weil diese Datei `index.html` entspricht, startet die App auch beim direkten Aufruf oder Neuladen einer Unterseite (z. B. `/habit-garden/aufgabe/…`) auf der richtigen Route. Der HTTP-Status ist dabei 404, was Browser in der Konsole als fehlgeschlagenen Ladevorgang vermerken.
- Sicherheits-Header: Pages setzt keine eigenen Header. Die Content-Security-Policy steht deshalb als `<meta http-equiv="Content-Security-Policy">` direkt nach `<meta charset>`. Sie entspricht der Richtlinie aus `index.php` einschließlich des Hashes der ausgegebenen Import Map, nur ohne `frame-ancestors`, das in Meta-Tags nicht wirkt. Aus `Referrer-Policy` wird `<meta name="referrer" content="no-referrer">`. `frame-ancestors`, `Strict-Transport-Security`, `X-Content-Type-Options` und `Permissions-Policy` lassen sich auf Pages nicht setzen; die Seite kann dort also in fremde Frames eingebettet werden. HTTPS erzwingt GitHub selbst.
- Caching: Pages liefert jede Datei mit fester Cache-Dauer (derzeit zehn Minuten) aus. Stylesheets, `main.js` und Bibliotheken wechseln mit dem Build-Stempel die URL; die per relativem Import geladenen App-Module können nach einem Deployment bis zum Ablauf dieser Frist noch aus dem Browser-Cache kommen.

## Daten und Sicherheit

- Die Daten liegen unverschlüsselt in IndexedDB. Ihr Schutz entspricht dem Schutz des Browserprofils und des Geräts.
- Safari löscht Website-Daten nach sieben Tagen ohne Besuch. Die Einstellungen weisen darauf hin, und HEUTE zeigt ab fünf Tagen ohne Export eine Karte „Daten sichern“.
- Erinnerungen werden nur bei geöffneter Seite ausgelöst.

## Lizenzen

Habit Garden steht unter der Apache License 2.0 (siehe [`LICENSE`](../LICENSE)).

| Komponente | Version | Lizenz | Verwendung |
|---|---|---|---|
| Dexie | 4.4.6 | Apache-2.0 | Laufzeit, `public/vendor/dexie.mjs` |
| markdown-it | 14.3.2 | MIT | Laufzeit, gebündelt mit entities (BSD-2-Clause), linkify-it, mdurl, punycode.js, uc.micro (jeweils MIT) |
| DOMPurify | 3.4.16 | MPL-2.0 oder Apache-2.0 | Laufzeit |
| Inter | 4.1 (npm `inter-ui` 4.1.1) | SIL Open Font License 1.1 | `public/assets/fonts/InterVariable.woff2`, Lizenztext daneben als `OFL.txt` |
| Lucide | 0.400.0 (`lucide-static`) | ISC | `public/assets/icons.svg` |
| TypeScript, esbuild | 5.9.3, 0.28.2 | Apache-2.0, MIT | nur Build |

### Herkunft der Pflanzengeometrie

Die SVG-Geometrie der Pflanze (Topf, Stängel, Blätter, Knospe, Seitenzweig; Koordinaten und Formelkoeffizienten aus F §4.11) stammt aus der Vorlage „Tend – A Habit Garden“: https://miaai-lab.github.io/Claude-Opus-5.5-100-HTML-Files/046-habit-garden.html, abgerufen am 11. Oktober 2026, SHA-256 `7798e072a66a1af82ce4032f47b6322d97945b69ebf7c63402944973123de58c`. Die Seite und ihr Repository nennen keine Lizenz. Übernommen wurden ausschließlich Geometriedaten; Code, Markup-Aufbau, CSS und Texte sind eigenständig geschrieben. Die Lizenzfrage ist offen und vor einer Veröffentlichung zu klären.

## Projektstruktur

```
public/            ausgelieferte Dateien (index.php, .htaccess, styles/, nach dem Build app/, vendor/, assets/)
dist/pages/        statische Fassung für GitHub Pages (npm run build:pages, nicht versioniert)
scripts/           Build-Skripte (vendor, sprite, stamp, clean, pages, Tests, Quelltextprüfung)
src/               TypeScript-Quellen: model, db, repo/, services/, components/, screens/, i18n/, util/
docs/abnahme/      Prüfprotokolle je Phase (TSV)
```
