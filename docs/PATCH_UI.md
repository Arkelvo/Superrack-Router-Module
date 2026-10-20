# Patch-Weboberfläche

Die Patch-Weboberfläche verbindet die Kanäle des Steuerpults mit den SuperRack-Racks. Das Mapping wird weiterhin unabhängig vom gewählten Transport gespeichert. Im ProLink-Modus werden die Racknamen aus der laufenden SuperRack-Sitzung angezeigt; im MIDI-Modus und bei unbekanntem Zustand bleiben die neutralen Racknummern sichtbar.

## Bedienung und Verhalten

- `GET /` leitet mit **HTTP 307 Temporary Redirect** auf `/patch` um. `/patch` und `/patch/` zeigen das Rack-/Kanal-Mapping; dieser Redirect betrifft nicht die API oder statische Dateien.
- Im verbundenen ProLink-Modus erscheinen die über `NotifyRacksConfigChanged` beobachteten Namen, z. B. `Voc Hannah` oder `Keys`, in der linken Spalte des Patchfelds. Die Zeilenreihenfolge und das Mapping bleiben unverändert. Bei einem leeren oder unbekannten Namen wird `Rack X` angezeigt.
- Ohne aktive ProLink-TCP-Verbindung, bei einem Transportwechsel oder bei nicht verfügbarer HTTP-API zeigt die Matrix nur `Rack X`. Es werden **keine veralteten Namen** aus einer vorherigen Verbindung angezeigt.
- Die Browseransicht fragt den Status regelmäßig ab (etwa alle **2 Sekunden**) und aktualisiert dabei ausschließlich Zeilenbeschriftungen. Racknamenänderungen in SuperRack erscheinen ohne Neuladen; bereits ausgewählte Patchzellen bleiben unverändert. Änderungen, die während des Polling-Intervalls passieren, werden beim nächsten erfolgreichen Abruf sichtbar.
- Die eigenständigen MIDI-Patch-Editoren `/midi/plugin` und `/midi/snapshot` sind nur im MIDI-Modus sichtbar und erreichbar. Im ProLink-Modus antworten ihre UI-Routen mit `404`. Bereits geöffnete MIDI-Editorseiten wechseln beim nächsten Statusabruf zur Rack-Patchansicht. Die vorhandenen MIDI-Mapping-APIs bleiben aus Kompatibilitätsgründen nutzbar. Gespeicherte MIDI-Hot-Plugin-/Snapshot-Zuweisungen bleiben beim Transportwechsel erhalten und sind nach Rückkehr zu MIDI weiterhin nutzbar.
- `/test` bleibt eine alternative Navigationsseite. Dort werden die MIDI-Editorlinks nur bei aktivem MIDI-Transport eingeblendet. Der reguläre Einstiegspunkt ist `/patch`.

## HTTP-Schnittstellen

`GET /patch/state` liefert einen JSON-Snapshot des **aktuellen** Modulzustands, ohne SuperRack-Befehle zu senden oder die Konfiguration zu verändern:

```json
{
  "transport": "prolink",
  "prolinkConnected": true,
  "racks": [
    { "id": 1, "name": "Voc Hannah", "observed": true },
    { "id": 2, "name": "Rack 2", "observed": false }
  ]
}
```

Die Daten dienen der UI-Präsentation. `observed=true` bedeutet, dass ein nichtleerer Rackname in einer SuperRack-Notification beobachtet wurde, **nicht**, dass dieses Rack gerade ausgewählt ist oder einen funktionierenden Audioweg besitzt. Die Liste ist auf die konfigurierte Rackanzahl (maximal 64) begrenzt. `Cache-Control: no-store` verhindert ein Wiederverwenden alter HTTP-Antworten.

`GET /patch/mappings` und `POST /patch/update` bleiben für die Kanal-/Rackzuordnung unverändert. Die bestehenden MIDI-Mapping-APIs bleiben aus Gründen der Rückwärtskompatibilität verfügbar. Die Oberfläche blendet die MIDI-Editoren transportabhängig aus.

## Fehlerdiagnose und Sicherheit

- Sind alle Namen `Rack X`, den Companion-Transport, die ProLink-Verbindung und die bereits vorhandenen `rack_N_name`/`rack_N_known`-Variablen prüfen.
- Bei HTTP-Fehlern setzt der Browser lediglich die angezeigten Namen zurück. Die Kanal-/Rackzuordnung im Modul wird nicht verändert.
- Die API gibt SuperRack-Namen als JSON aus; der Browser verwendet `textContent` (kein HTML-Parsing), sodass Namen keine Skripte ausführen können.
- Der HTTP-Server bleibt entsprechend der bisherigen Modulkonfiguration im Kontrollnetz erreichbar. Bei ungeschützter Netzfreigabe geeignete Netzsegmentierung/Zugriffsbeschränkung vorsehen.

## Grenzen

Die ProLink-Schnittstelle bestätigt nicht zuverlässig das aktuell **sichtbar ausgewählte Rack**, wenn es manuell in SuperRack gewechselt wurde. Daher wird keine fiktive Auswahl-Rückmeldung berechnet. Abfragen `GetRackName` und `GetRacksInfo` sind unabhängig von der bereits nachgewiesenen asynchronen Gesamtkonfiguration und werden weiter in der Rack-Synchronisierungsphase untersucht.

## Racknamen mit dynamischer Spaltenbreite

Alle Beschriftungen der Rack-Zeilen stehen in **einer gemeinsamen Grid-Spalte**. Deren Breite passt sich automatisch an den längsten gerade angezeigten Namen an (`max-content`); ein langer Name wird nicht umgebrochen, abgeschnitten oder durch Auslassungspunkte ersetzt. Die Kanalspalten bleiben jeweils 30 px breit. Falls die Matrix breiter als das Browserfenster wird, kann sie innerhalb der bestehenden Patch-Ansicht horizontal gescrollt werden.

Die Darstellung funktioniert auch bei Live-Umbenennungen, bei einem Wechsel des Transports und beim neutralen Fallback `Rack X`. Die Matrix und ihre Eventhandler werden dabei nicht neu erstellt; Änderungen betreffen nur Text und CSS-Grid-Breite. Diese Anpassung gilt nur für das Rack-/Kanal-Patchfeld und verändert die MIDI-Editoren nicht.
