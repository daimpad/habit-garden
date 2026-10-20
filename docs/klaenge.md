# Klänge

Sieben kurze Naturklänge (Entscheidung vom 20.10.2026), erzeugt mit ElevenLabs Sound Effects (`eleven_text_to_sound_v2`, je vier Varianten). Die beste Variante wurde mit ffmpeg zugeschnitten, gefiltert (Hoch- und Tiefpass), ein- und ausgeblendet und auf ähnliche Lautheit gebracht (Momentan-Lautheit, Spitze höchstens −1 dBFS), dann als MP3 mono gespeichert. Abgespielt werden sie von `src/services/sound.ts`.

| Datei | Moment | Beschreibung (Prompt) | Ausschnitt |
|---|---|---|---|
| `water.mp3` | Routine gegossen | Single soft water droplet falling into a small pool, gentle round plop, close-mic, quiet | 0,10 s + 0,32 s |
| `grow.mp3` | Nächste Stufe | Gentle rustle of a few fresh green leaves, short soft swish, close-mic, quiet | 0,12 s + 0,62 s, Tiefpass 6 kHz |
| `bloom.mp3` | Volle Blüte | Wooden wind chimes … (einzelner Anschlag) | 0,14 s + 0,86 s |
| `milestone.mp3` | Spur im Garten | Wooden wind chimes softly stirred by a light breeze, gentle short cascade, outdoors, quiet | 0 + 1,0 s |
| `tap.mp3` | Aufgabe erledigt | Single soft knock on a small hollow wooden block, short warm tap, close-mic, quiet | 1,98 s + 0,40 s |
| `fire.mp3` | Ins Feuer erzählt | Small campfire crackling softly, close-mic, a few gentle wood pops | 0,10 s + 1,60 s |
| `keimi.mp3` | Keimi grüßt | Tiny songbird single short chirp, soft and friendly, close-mic | 0,22 s + 0,34 s |

Zusammen etwa 66 KB. Der Service Worker legt sie wie alle Dateien unter `assets/` in den Offline-Cache.

Die Nutzungsrechte an den erzeugten Klängen richten sich nach dem ElevenLabs-Tarif des Kontos, mit dem sie erzeugt wurden. Einstellungen › Info nennt die Herkunft.
