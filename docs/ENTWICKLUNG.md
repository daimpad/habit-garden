# Habit Garden – Entwicklung

Technische Dokumentation zu Habit Garden: Aufbau, Build, Auslieferung, Lizenzen. Die Beschreibung der App für Nutzerinnen und Nutzer steht im [README](../README.md).

Habit Garden ist eine local-first Website. Alle Daten liegen ausschließlich im Browser (IndexedDB). Es gibt kein Konto, keine Datenbank auf dem Server und keine Telemetrie; Export und Import (JSON) sind der einzige Transferweg.

Stand: Phase 1 (Grundgerüst) mit dem Garten-Redesign vom 12.10.2026 und Phase 2 vom 13.10.2026 (Wiederholungen mit Folgeinstanz, Unteraufgaben, Schnellsyntax, Abendkarte) sowie Phase 3 (PLANUNG mit Bereichs-Chips, Projekten, Liste, Inbox und Projektseite; Kanban und Matrix mit Ziehen, Suche mit Filterchips, Wischgesten, ICS-Export eines Projekts, Bereiche umsortieren, Archiv; Projekt, Status und Verlauf im Aufgaben-Sheet). Phase 4 (WISSEN: Notizliste mit Suche, Schlagwort-Baum mit UND/ODER als URL-Zustand, Markdown-Editor mit Werkzeugleiste, Vorschau und Autosave, Notiz-Links `[Titel](note:<id>)` mit Rückverweisen, „Aufgabe aus Zeile“, Anheften und Archivieren per Wischen, Markdown-Export, ICS aller Aufgaben). Markdown wird mit markdown-it (`html: false`) gerendert und mit DOMPurify bereinigt (ohne `style`, Bilder nur als Links wegen `img-src 'self'`). Phase 5: Dunkelmodus („Nachtgarten“, Thema Hell/Dunkel/System, `src/theme-boot.ts` setzt `data-theme` vor dem ersten Bild als externes Skript, CSP unverändert), Landschaft mit Sonne/Mond nach Uhrzeit (abschaltbar, Profil-Schema 2), Rückblick (`/heute/rueckblick`, `services/review.ts`), Kalender-Sheet und Tagesansicht (`/heute/tag/{Datum}`, `services/calendar.ts`), Reaktivieren archivierter Routinen. Nachbesserungen vom 13.10.2026: Kalenderdatei in Ortszeit (TZID/VTIMEZONE), Markdown-Import, Aufräumen verwaister Schlagworte, Standard-Thema „System“, meta theme-color; Checkliste für den Telefontest in [telefontest.md](telefontest.md).

## Garten und Personen

Auf Wunsch des Product Owners weicht HEUTE seit dem 12.10.2026 bewusst von der zurückhaltenden Gestaltung des Feinkonzepts (Calm Technology) ab:

- Hero: Datum, Begrüßung nach Tageszeit, Fortschritt „x von y heute gegossen“ und eine Landschaft, deren Himmel sich nach der Tageszeit färbt; die Sonne wandert, nachts steht ein Mond.
- Garten-Insel (seit 13.10.2026, Teil 1, ersetzt die Wiese): Eine schwebende Insel im Hero (Telefon unter dem Begrüßungstext, ab 900 px rechts daneben). Jeder Standardbereich hat einen Ort, gefunden über seine Blume: Wohnen & Alltag das Häuschen (Tür in der Bereichsfarbe), Gesundheit & Fitness Teich mit Bach, Brücke und Wasserfall, Beziehungen der große Baum mit Bank, Beruf & Karriere der Schuppen, Persönliche Entwicklung Laterne und Lesestumpf, Freizeit & Erholung die Picknickdecke, Finanzen & Wohlstand Brunnen und Obstbaum. Eigene Bereiche (Blume „generic“ oder eine schon vergebene Blume) nehmen im Uhrzeigersinn den nächsten freien Ort, ab dem achten Bereich teilen sie sich ein Blumenbeet „Weitere Bereiche“ (`services/island.ts`, `assignPlaces`). Jeder Ort blüht in vier Stufen nach der mittleren Pflanzenstufe seiner aktiven Routinen auf; bis zu sechs Pflanzen stehen in seinen Beeten (mehr: die sechs weitesten und „+n“), heute gegossene auf dunkler, feuchter Erde. Orte fehlender Bereiche sind eine ruhige Lichtung; Teich, Bach und großer Baum gehören zur Landschaft. Ein Tipp auf einen Ort (oder Tab und Enter) öffnet ein Blatt mit den Routinen des Bereichs, ihren Gießknöpfen (derselbe Ablauf wie auf den Karten) und dem Weg zur Routine (`screens/sheets/place.ts`). Keimi steht auf der Insel und sagt einen kurzen Satz ohne Begrüßung, nach fester Reihenfolge: Nacht, wartende Pflanzen, offene Fokus-Aufgaben, eine fällige Person, alles gegossen, noch keine Routine, Abend, freier Tag (`keimiLine`). Ein Tipp blendet die Sprechblase für den Tag aus (sessionStorage). Dunkles Thema und Nachtphase zeigen erleuchtete Fenster, Laterne und Glühwürmchen. Die Insel ist ein SVG (`components/island.ts`, unter 70 KB, ohne `style`-Attribute und Filter, eindeutige ids je Insel), das nur bei geänderten Daten neu gebaut wird; Farben über `--isl-*` in `tokens.css`. Für Screenreader gibt es eine verborgene Liste aller Bereiche mit ihrem Gießstand und ihrer Balance.
- Garten-Insel Teil 2 (13.10.2026): Unter der Insel schaltet „Garten · Balance“ (`ol-segmented`, Wahl pro Browser in `localStorage`, Standard Garten) die Ansicht um. Balance zeigt an jedem Ort eine Pille „Gesundheit 60 %“ mit einem Punkt in der Bereichsfarbe und den Chip „Insgesamt: <Zustand>“; Keimis Sprechblase ruht dann. Die Prozentzahl ist die Erfüllung der Routinen des Bereichs in den letzten 30 Tagen nach den Regeln des Rückblicks (`balancePercent` in `services/island.ts` nutzt `fulfilments`, `overallRate` und `lastDays` aus `services/review.ts`), der Chip entspricht „Erfüllt“ im Rückblick. Bereiche ohne Routine oder ohne fälligen Tag zeigen „–“. Zustandswörter nach der gerundeten Zahl: unter 30 % keimend, unter 55 % wachsend, unter 80 % blühend, sonst verwurzelt. Kurznamen: Standardbereiche mit unverändertem Namen nach ihrer Blume („Entwicklung“), sonst der ganze Name bis 12 Zeichen, darüber das erste Wort. Ein Tipp auf eine Pille öffnet das Blatt des Ortes; in der Balance sind die Pillen die Tastaturziele der Orte. Die Pillen werden nach jeder Änderung und bei jeder Größenänderung gemessen und ohne Überlappung gesetzt (`layoutLabels`): am Anker oder am nächsten freien Platz, nie über Keimi, Figuren, Sprechblase, Schalter oder den Rand (über einem Teil der großen Tippfläche eines Ortes darf eine Pille liegen).
- Routinen-Karten: Pflanze im Bogenfenster, Stufe, „Noch n Tage bis …“ (`nextStage` in `services/growth.ts`), Tage in Folge, „Heute gießen“ und eine 12-Wochen-Heatmap.
- Personen: Name, Wunschrhythmus (wöchentlich, alle zwei Wochen, monatlich, vierteljährlich), Notiz und Kontaktverlauf mit optionaler Art (Anruf, Nachricht, Treffen). „Melde dich bei“ schlägt bis zu drei Personen vor, deren Rhythmus am weitesten überschritten ist. Auf der Insel steht jede Person als kleiner Keimling (Keimis Familie, in ihrer Farbe) im Hain um den großen Baum und die Bank: im Rhythmus nah an der Bank mit aufrechten Blättern, überfällig etwas abseits, blasser und mit hängenden Blättern. Höchstens fünf Figuren (überfällige zuerst, heute kontaktierte bleiben), der Rest als „+n“, das „Alle Personen“ öffnet. Fünf feste Plätze von der Bank nach außen: Personen im Rhythmus von der Bank an, überfällige vom äußeren Ende her. Jede Figur ist ein Knopf zur Person mit einer Pille „Lena · 80 %“: 100 % im Rhythmus, ab dem fälligen Tag linear bis 0 % beim doppelten Rhythmus (höchstens 99 % sobald fällig, nie kontaktiert 0 %; `closeness` in `services/contacts.ts`). Die Pillen erscheinen in der Balance immer, im Garten bei Platz (Inselbreite ab 560 px) oder bis zu drei Personen, und nur wenn alle neben ihre Figur passen (alle oder keine); auf dem Telefon passen bis zu drei, fünf meist nur auf breiten Bildschirmen. Nach „Kontaktiert“ hüpft die Figur (nicht bei reduzierter Bewegung). Verwaltung über „Alle Personen“ (`screens/sheets/people.ts`).
- Bewegung: Wiegende Blätter der Figuren, ihr Hüpfen und ziehende Wolken laufen nur in CSS und stehen still bei „Bewegung reduzieren“ im System oder bei „Animationen: reduziert“ in den Einstellungen.
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
