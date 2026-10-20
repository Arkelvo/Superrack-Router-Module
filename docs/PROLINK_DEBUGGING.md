# ProLink-Debugging

## Eingangsnachrichten und Rückmeldungen

SuperRack sendet einzelne Benachrichtigungen unter Umständen wiederholt, auch wenn deren Argumente unverändert bleiben. Häufige identische `NotifyControllerProperties`- oder `NotifyControllerValue`-Pakete sind alleine kein Hinweis auf eine instabile Verbindung oder einen fehlgeschlagenen Befehl.

Die Nachrichten werden weiterhin mit `decodeOsc` gelesen und durch die zuständige Zustandsverarbeitung ausgewertet. Im Debug-Log erscheinen fokussierte Controllerdaten standardmäßig **nur bei tatsächlich beobachteten Änderungen**:

- `[PROLINK_CONTROLLER_PROPERTIES_CHANGED]`: geänderte Eigenschaften des gerade fokussierten Touch-and-Turn-Controllers.
- `[PROLINK_CONTROLLER_VALUE_CHANGED]`: geänderter Wert/Text desselben Controllers.
- `[PROLINK_CONTROLLER_PROPERTIES_INVALID]`, `[PROLINK_CONTROLLER_VALUE_INVALID]`: unpassendes Datenformat.
- `[PROLINK_CONTROLLER_READBACK_UNCONFIRMED]`: nach einem lokal gesendeten relativen Eingriff keine neue Wertbeobachtung innerhalb des vorgesehenen Fensters.

Die allgemeinen `[PROLINK_RX]`-Meldungen bleiben für andere OSC-Pfade verfügbar. Fehler beim OSC-Decoding erscheinen als `[PROLINK_RX_RAW]` und/oder `[PROLINK_OSC_INVALID]`. Rackänderungen und Befehlsergebnisse werden weiterhin gesondert protokolliert.

## Interpretation

`NotifyControllerValue` liefert einen Anzeige-String und eine interne Fließkommazahl. Der Rohwert ist **keine bestätigte dB-Skalierung**. `NotifyControllerProperties` enthält derzeit 13 Positionsfelder; deren weitergehende Semantik ist nicht überall belegt. Beide Meldungen beziehen sich auf den fokussierten Controller, nicht auf beliebig adressierbare Pluginparameter.

Ein erfolgreiches `ResultCommand` bestätigt eine Antwort auf einen gesendeten Befehl, aber nicht automatisch die physikalische oder musikalische Wirkung. Eine geänderte Controller-Notification nach einem Befehl ist ebenfalls kein eindeutiger Kausalitätsnachweis.

Bei Bedarf kann ein Netzwerkpaketmitschnitt zusätzlich alle Rohereignisse dokumentieren; das Änderungs-Logging ist bewusst kein vollständiger Traffic-Capture.

## Verbindungsende

`destroy start` und `destroy done` zeigen die Ausführung des Modul-Lebenszyklus. Daraus allein lässt sich weder ein Absturz noch der Anlass des Herunterfahrens ableiten. Zur Ursachenklärung gehören Companion-Prozess-, Instanz- und Konfigurationslogs vor dem Shutdown.
