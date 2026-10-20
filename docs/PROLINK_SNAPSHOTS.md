# SuperRack-Snapshots über ProLink

Die ProLink-Schnittstelle bietet lesende Abfragen der aktuellen Snapshotnummer, eines Snapshotnamens anhand seiner Provider-ID und der Snapshotliste. Die Companion-Actions `ProLink: Get current snapshot number`, `ProLink: Get snapshot name by provider ID` und `ProLink: Get snapshot list` verwenden diese Abfragen. Die hier dokumentierte Listenstruktur wurde am 20.10.2026 live mit SuperRack Performer beobachtet.

## Lesende Daten und Companion-Variablen

| Variable | Bedeutung |
|---|---|
| `prolink_snapshot_current_known` | Eine gültige Antwort auf `GetCurrentSnapshotNumber` wurde beobachtet |
| `prolink_snapshot_current_number_raw` | Signierte Ganzzahl aus `GiveCurrentSnapshotNumber` (Providersemantik noch zu prüfen) |
| `prolink_snapshot_last_name_target_id` | Provider-ID der letzten korrekt zugeordneten Namensabfrage |
| `prolink_snapshot_last_name` | Antwortname auf diese ID, auch ein leerer Name ist möglich |
| `prolink_snapshot_names_json` | JSON-Objekt bekannter Namen, nach Provider-ID indiziert |
| `prolink_snapshot_list_known` | Eine passende `GiveListOfSnapshot`-Antwort wurde empfangen |
| `prolink_snapshot_list_raw` | Unveränderte Antwortargumente der Liste nach der Request-ID als JSON-Array |
| `prolink_snapshot_count` | Anzahl der Snapshots in der validierten Liste |
| `prolink_snapshot_list_json` | Normalisierte Liste `[{"id":0,"name":"..."}]` für UI und Companion |

**Wichtig:** Die Snapshotnummer, eine Provider-ID und ein MIDI-Hot-Snapshot sind nicht ohne Beleg gleichzusetzen. `GetSnapshotName`-Antworten besitzen keine eigene Snapshot-ID; diese wird allein über die ausgehende Request-ID und den beim Senden gespeicherten Abfrageparameter zugeordnet. Auch Antworten auf mehrere gleichzeitig laufende Abfragen bleiben dadurch korrekt zugeordnet.

### Live bestätigtes Format

Die Antwortadresse lautet **`GiveListOfSnapshot`** (Singular), nicht `GiveListOfSnapshots`:

```text
/waves.com/remote/GiveListOfSnapshot
[Request-ID, Anzahl, Snapshot-ID, Snapshot-Name, Snapshot-ID, Snapshot-Name, ...]
```

Beispiel aus SuperRack Performer:

```json
[0, 2, 0, "Test", 1, "Test2"]
```

Hier bezeichnet `0` an erster Stelle die Abfrage-Request-ID, `2` ist die Anzahl, gefolgt von den Snapshot-IDs `0` und `1` und ihren Namen. Die ID ist ausdrücklich nicht die Position eines MIDI-Hot-Slots. `GiveCurrentSnapshotNumber` wurde live mit `[1, 1]` und `[9, 0]` erfasst, `GiveSnapshotName` mit `[12, "Test"]`. Die Interpretation dieser Werte als aktuelle Provider-IDs ist plausibel, aber die tatsächliche Snapshot-Selektion wurde unabhängig davon noch nicht durchgängig per UI-Mitschnitt abgesichert.

Ein Listenpaket wird ausschließlich bei exakt passender Anzahl, eindeutigen nichtnegativen IDs, gültigen Namen und korrekter Request-Korrelation übernommen. Unvollständige oder doppelte Einträge werden verworfen. Die letzte gültige vollständige Liste ersetzt frühere Listeneinträge; `GetSnapshotName` aktualisiert den Namen eines bereits gelisteten Eintrags. Bei Disconnect werden die Daten und dynamischen Auswahlmöglichkeiten verworfen.

### Actions mit dynamischen Namen

Die ursprünglichen Actions `ProLink: Recall snapshot by provider ID` und `ProLink: Highlight snapshot by provider ID` behalten ihre numerischen Eingaben und bisherigen Freigabeschalter. Hinzu kommen:

- **ProLink: Recall snapshot from observed list** – zeigt Snapshotname und echte Provider-ID in einer Auswahl.
- **ProLink: Highlight snapshot from observed list** – verwendet dieselbe validierte Liste.

Bis eine vollständige Liste geladen ist, bleiben die Auswahllisten leer und neue Aktionen senden nichts. Veraltete IDs werden auch dann zurückgewiesen, wenn sie noch in gespeicherten Companion-Buttons stehen. Alle tatsächlich versendeten Schreibbefehle laufen weiterhin durch die bereits vorhandenen gesonderten Freigabeschalter (`prolinkRecallEnabled`/`prolinkHighlightEnabled`). Es gibt keine automatische Snapshotänderung und keinen automatischen Recall beim Empfang der Liste. Der Anwender kann die bekannte Liste durch `GetListOfSnapshots` erneut lesen.

## Sicherheit und Gültigkeit

- Nur eine zu einer offenen Abfrage passende `Give*`-Antwort setzt Snapshotvariablen. Ein `ResultCommand` alleine ist kein Snapshot-Readback.
- Ein fehlerhaft typisierter Antwortwert wird verworfen, ohne die korrelierte Abfrage vorzeitig als erfolgreich abzuschließen.
- Unbekannte oder doppelte Antworten dürfen vorhandene Snapshotnamen nicht überschreiben.
- Bei Verbindungsabbau oder Transportwechsel werden gespeicherte Snapshotwerte gelöscht. Bei weiter verbundener Sitzung kann ein Sessionwechsel Daten veralten lassen; bis ein eindeutiges Session-Changed-Signal verifiziert ist, sind erneute Abfragen ratsam.
- Die Namen sind pro Verbindung auf 512 Einträge und 2.048 Zeichen pro Eintrag begrenzt. Rohe Listenantworten sind auf 65.536 Zeichen begrenzt.
- **Die Snapshotabfragen selbst sind ausschließlich lesend.** Die zusätzlich verfügbaren, explizit ausgelösten Recall-/Highlight-Actions können einen Snapshotwechsel auslösen, wenn der entsprechende Freigabeschalter aktiviert wurde. Die übrigen Snapshot-Schreiboperationen sind damit nicht implementiert.

## Protokollnachweis

Registrierte Abfragen und erwartete Rückmeldungen aus dem ProLink-Reverse-Engineering:

| Abfrage | Antwort |
|---|---|
| `GetCurrentSnapshotNumber` | `GiveCurrentSnapshotNumber` |
| `GetSnapshotName` | `GiveSnapshotName` |
| `GetListOfSnapshots` | **`GiveListOfSnapshot`** (Singular) |

Die Binäranalyse bestätigt Adressen und Request-ID-Korrelation. Das hier dokumentierte Listenformat wurde mit zwei Snapshots live beobachtet. Weitere Tests mit leerer Liste, vielen Snapshots und einer Sessionänderung sind sinnvoll; eine spontane Push-Benachrichtigung des aktuell ausgewählten Snapshots ist noch nicht belegt.
