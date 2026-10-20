# ProLink: Relative Steuerung des ausgewählten Touch-and-Turn-Controllers

Der ProLink-Befehl `ChangeControllerValue` ändert **relativ den gerade ausgewählten Controller** in SuperRack. Er enthält zwei OSC-Integer: `(requestId:int32, delta:int32)`.

Die Companion-Action **ProLink: Adjust selected Touch-and-Turn controller (relative)** bietet eine Richtung (`+`/`−`) und eine ganze Magnitude von 1 bis 8. Das ist **kein Betrag in dB, Hz oder Prozent**, sondern eine protokollinterne relative Änderung. Die Wirkung hängt vom ausgewählten Pluginparameter, seiner Wertecharakteristik und dem Waves-Host ab. Die Richtung kann nicht für alle Bedienelementtypen pauschal als „lauter/leiser“ interpretiert werden.

## Voraussetzungen

- ProLink ist verbunden und von SuperRack zugewiesen.
- Die Companion-Action **Subscribe to focused controller updates** ist aktiviert.
- `NotifyControllerProperties` (13 Felder) und `NotifyControllerValue` (Werttext, Raw-double) wurden für den ausgewählten Control beobachtet.
- Nur dann darf ein relativer Write ausgelöst werden. Die Action steuert keinen frei benannten Rack-/Slot-/Parameterindex.

## Auswertbare Rückmeldungen

| Variable | Bedeutung |
|---|---|
| `prolink_controller_name` | Bezeichnung des fokussierten Controllers |
| `prolink_controller_unit` | Zugehöriger, gelieferter Unit-String |
| `prolink_controller_text` | Formatiert angezeigter Wert |
| `prolink_controller_value` | Uninterpretierter double-Rohwert |
| `prolink_controller_write_delta` | Gesendete relative Änderung |
| `prolink_controller_write_status` | `awaiting_change`, `observed_after_send`, `unconfirmed`, `context_changed` oder `idle` |

`observed_after_send` bedeutet lediglich, dass nach dem Senden eine **geänderte Notification** beobachtet wurde. Sie beweist keine Kausalität und keinen absoluten erreichten Sollwert. Fokuswechsel setzt vorherige Werte zurück und invalidiert einen noch offenen Readback-Versuch.

## Unterstützte und nicht unterstützte Operationen

- **Unterstützt:** Fokussierten Controller relativ verändern; Änderungen und Eigenschaften beobachten; Ergebniscode einer gesendeten Aktion verfolgen.
- **Nicht belegt:** beliebige Parameter einer ausgewählten Plugininstanz absolut auf einen Zielwert setzen; generische dB-/Hz-Kalibrierung aller Plugins; diskrete Schalter als absolute 0/1-Werte beschreiben.
- **Entfernt:** Das experimentelle, ausschließlich auf den Threshold des PSE-Plugins zugeschnittene dB-Modell. Es wurde durch die allgemeine relative Steuerung ersetzt.

**Referenz:** REA-Findings F013–F017 und F039–F047; Live-OSC-Beobachtungen zu `NotifyControllerProperties`, `NotifyControllerValue` und `ResultCommand`.
