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
