# ProLink: Zustand des ausgewählten Touch-and-Turn-Controllers

SuperRack veröffentlicht für den gerade fokussierten Touch-and-Turn-Control zwei eigenständige Nachrichten:

- `NotifyControllerProperties`: 13 typisierte Positionsfelder (String, bool, Integer, Double); die weitergehende Fachsemantik einiger Felder ist noch unklar.
- `NotifyControllerValue`: ein formatierter Werttext und ein numerischer `double`-Rohwert.

Diese beiden Nachrichten enthalten **keine Rack-/Slot-/Parameteradresse und keine Request-ID**. Der Fokus muss in SuperRack bestehen; ein gemeldeter Wert ist nicht beliebig einem Plugin zuzuordnen.

## Bekannte Eigenschaften

| Feldindex | Datentyp | In Companion |
|---|---|---|
| 0 | String | `prolink_controller_name` |
| 1 | Boolean | nur vollständiges Raw-JSON |
| 2 | Integer | nur vollständiges Raw-JSON |
| 3, 4 | Double | `prolink_controller_bounds_a_raw`, `prolink_controller_bounds_b_raw` (Fachsemantik nicht abschließend belegt) |
| 5 | String | `prolink_controller_unit` |
| 6, 7 | Double | nur vollständiges Raw-JSON |
| 8 | Boolean | nur vollständiges Raw-JSON |
| 9 | Integer | nur vollständiges Raw-JSON |
| 10 | String | `prolink_controller_aux_text_raw` |
| 11, 12 | String | `prolink_controller_bounds_a_text_raw`, `prolink_controller_bounds_b_text_raw` |

Die vollständige Feldliste bleibt als `prolink_controller_properties` (JSON) verfügbar. Numerische Rohwerte sind nicht automatisch normierte VST3-Werte oder physikalische Maßeinheiten. Eine Umrechnung ohne Parameterkenntnis wäre unzuverlässig.

## Zustandsmodell

Nach Empfang einer gültigen Properties-Meldung wird `prolink_controller_properties_known` wahr. Eine neue Properties-Konfiguration erhöht die lokale `prolink_controller_context_version` und verwirft gegebenenfalls einen zuvor beobachteten Wert. Bei gültiger Value-Meldung wird `prolink_controller_known` wahr. Doppelte identische Meldungen verändern Companion-Variablen nicht unnötig.

Bei Trennung werden die beobachteten Werte und die Schreibdiagnostik zurückgesetzt. Die relative Steuerung verwendet diese Zustände als Sicherheitsschranke, bleibt jedoch auf den fokussierten Parameter begrenzt.

**Referenzen:** REA-Analyse F031 sowie F039–F047 und die dokumentierten Live-OSC-Captures aus SuperRack Performer.


## Automatische Subscription (P5)

Bei jeder neuen **ProLink-TCP-Verbindung** sendet das Modul einmalig
`RequestControllerInfoUpdates(true)` über den bereits verbundenen Service,
zusätzlich zur automatischen Snapshotlisten-Abfrage. Das gilt auch für
Disconnect/Reconnect. Es ist keine manuelle Companion-Action zum Aktivieren
mehr notwendig. Die vorhandene manuelle Subscription-Action bleibt für
Diagnosezwecke bestehen.

Die Variablen `prolink_controller_auto_subscription_status` und
`prolink_controller_auto_subscription_sequence` beschreiben **nur die
letzte automatische Subscription dieses TCP-Peers**:

- `idle`: Verbindung nicht aktiv oder Zustand zurückgesetzt.
- `requesting`: Request gesendet, Bestätigung noch nicht zugeordnet.
- `acknowledged`: Passendes erfolgreiches `ResultCommand` erhalten; **kein Beweis für eintreffende Notifications**.
- `receiving_updates`: Nach dem Request mindestens eine valide
  `NotifyControllerProperties`- oder `NotifyControllerValue`-Nachricht empfangen.
- `unconfirmed`: Keine passende Bestätigung im Request-Timeout und noch keine valide Notification.
- `rejected_or_unknown`: Fehlgeschlagenes bzw. unerwartetes `ResultCommand`.
- `send_failed`: Sendeversuch ist bereits lokal gescheitert.

Nach Disconnect werden Controller-Properties, Value, Request-Status und
Auto-Subscription-Zustand verworfen. Bei Reconnect wird neu subscribed;
alte Werte gelten nicht als aktueller Parameter. Wiederholte identische
Properties-/Value-Pakete werden weiterhin verarbeitet, aber nicht mehrfach
als Werteänderungen protokolliert.

### Pluginübergreifender Geltungsbereich

Die Subscription beobachtet den **jeweils fokussierten Touch-and-Turn-Controller**
unabhängig vom Plugin-Namen. Es gibt keinen belegten OSC-Parameteradressraum,
mit dem beliebige Slots oder Parameter ohne SuperRack-Fokussierung direkt
adressiert werden können. `ChangeControllerValue` verwendet generische
signed-int32-Relativschritte (-8 bis +8 ohne 0), **keine festen dB-Schritte**.
Die angezeigte `prolink_controller_text`-Zeichenfolge stammt vom Plugin;
`prolink_controller_value` ist ein roher double-Wert.

Das manuelle Deaktivieren der Subscription kann den Stream abschalten;
der Auto-Subscription-Status bezieht sich dann weiterhin auf den ursprünglichen
Initialisierungsrequest und ist keine kontinuierliche Remote-Abfrage.

## Empirischer Vergleich diskreter Controller (2026-10-24)

Zusätzliche reale Companion-/SuperRack-Beobachtungen:

| Ausgewählter Parameter | Properties[1], Properties[2] | `ChangeControllerValue` | Beobachteter Wert |
|---|---|---|---|
| Tune RT – Speed | `true, 0` | reagiert | Wertänderung bestätigt |
| Tune RT – Note Transition | `true, 0` | reagiert | Wertänderung bestätigt |
| Tune RT – Scale Type | `false, 44` | ResultCommand `succeeded`, **keine Wertänderung** bei +1 oder +8 | `Major` blieb bei Rohwert 2 |
| CLA-76 – Analog | `false, 3` | ResultCommand `succeeded`, **keine Wertänderung** bei +1 | `60Hz` blieb unverändert |

**Arbeitshypothese:** Feld 1 beschreibt eine relative/andersartige Controllerklasse und Feld 2 könnte bei `false` die Anzahl wählbarer Zustände sein. Weder die Bedeutung der Felder noch ein absolutes Setzkommando sind protokollseitig belegt. Feld 2 ist **keine nachgewiesene Parameteradresse**. Auch `ResultCommand succeeded` ist keine Bestätigung einer Wertänderung.

**Sicherheitsgate ab V4:** `ChangeControllerValue` wird nur bei frisch beobachteten Properties und Value, aktivem ProLink-Transport und dem empirisch funktionierenden Muster `true, 0` freigegeben. Für `false` (diskreter Kandidat), unbekannte Kombinationen, fehlende/veraltete Daten oder getrennte Verbindung wird kein Schreibkommando gesendet. Das bestehende schnelle Senden mehrerer relativer Inkremente an kontinuierliche Controller bleibt möglich. Ein späteres `NotifyControllerValue` ist eine Beobachtung, kein kausaler Wirknachweis für jede einzelne Encoderbewegung.

Die Action `ProLink: Inspect focused controller write capability (read-only)` veröffentlicht `prolink_controller_capability_json`. Darin stehen rohe Felder, der Zustand der Schreibschranke und explizite Flags für nicht verifizierte direkte Parameteradressierung und absolute diskrete Schreibzugriffe. Weitere Variablen: `prolink_controller_kind_candidate`, `prolink_controller_discrete_count_candidate` und `prolink_controller_write_guard_reason`. Die Klassifizierung bleibt heuristisch und absichtlich konservativ. Sie ersetzt keine Live-Verifikation an beliebigen anderen Plugins.

Die ProLink-Kommandoliste im vorhandenen Codec enthält kein nachgewiesenes absolutes Setzen oder Fokussieren diskreter Pluginparameter. Waves beschreibt die reguläre ProLink-Integration als Touch-and-Turn-Steuerung ausgewählter Pluginparameter; daraus folgt keine Garantie einer universellen diskreten Remote-Write-API. Zur Aktivierung direkter Tune-Key-Actions wäre eine dokumentierte oder anderweitig belegte ProLink-Adressierung beziehungsweise ein belegter anderer Controller-Schreibbefehl nötig.

## Experimentelle SwitchControllerValue-Diagnose (V5)

Aus dem vom Nutzer bereitgestellten statischen Reverse-Engineering-Artefakt
für SuperRack Performer 15.15.12.13 ergibt sich eine OSC-Eingangsregistrierung
`/waves.com/remote/SwitchControllerValue` mit Typtags `,iT` bzw. `,iF`:
Request-ID als int32 plus boolesches OSC-Typetag (ohne Payloadbytes).
Der rekonstruierte Hostpfad schreibt bei `true` für einen geeigneten
**ausgewählten schaltbaren Controller** einen relativen Schritt `1.0`.
`false` ist im dokumentierten Zweig ein **No-op**, kein absolutes Setzen auf null.
Diese Information wurde statisch rekonstruiert; die Wirkung in der laufenden
SuperRack-Version ist noch nicht live verifiziert.

Die Action **ProLink EXPERIMENT: Switch focused discrete controller (one touch)**
führt genau einen manuellen Schreibtest aus. Zuvor werden eine laufende ProLink-
Verbindung, die innerhalb der letzten drei Sekunden empfangenen Properties und
Value, die bisher beobachtete diskrete Shape sowie Pluginname und Parametername
geprüft. Zugelassen sind ausschließlich `Tune RT / Scale Type` (`false, 44`)
und `CLA-76 / Analog` (`false, 3`). Die Action ignoriert `false`, sendet keinen
Release-Befehl und hat weder eine automatische Wiederholung noch einen
Regelkreis. Ein offener Schreibversuch oder eine erneute Aktion innerhalb von
zwei Sekunden wird blockiert. Ein Status `observed_after_send` ist nur eine
beobachtete Wertänderung, keine kausale Bestätigung des Befehls.

**Sichere Testfolge:** In einer Testsession `Scale Type` manuell auf `Major`
setzen und fokussieren. Prüfen, dass Companion `Scale Type`, `Tune RT` und
`Major` meldet. Die Action mit `Tune RT — Scale Type only` genau **einmal**
ausführen. Sichtbaren Skalentyp, `NotifyControllerValue`,
`PROLINK_COMMAND_RESULT` und `prolink_controller_write_status` notieren.
Mit Erfolg allein durch `ResultCommand` darf nicht gerechnet werden.
Bei ausbleibender Wirkung keine Magnitude-Experimente vornehmen.

Die bisherige Sperre von `ChangeControllerValue` für diskrete Controller
bleibt vollständig erhalten. Eine freie Rack-/Slot-/Parameteradressierung ist
auch mit `SwitchControllerValue` nicht nachgewiesen. Interne Funktionen wie
`SetControllerValue`, `WP_SetControllerValue`,
`SetControllerValueFromText` stammen aus anderen Bibliotheksschichten und
sind **keine** dadurch automatisch zugänglichen ProLink-OSC-Kommandos.
