# SuperRack-Snapshots über ProLink

Die ProLink-Schnittstelle bietet lesende Abfragen der aktuellen Snapshotnummer, eines Snapshotnamens anhand seiner Provider-ID und der Snapshotliste. Die Companion-Actions `ProLink: Get current snapshot number`, `ProLink: Get snapshot name by provider ID` und `ProLink: Get snapshot list` verwenden diese Abfragen.

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

**Wichtig:** Die Snapshotnummer, eine Provider-ID und ein MIDI-Hot-Snapshot sind nicht ohne Beleg gleichzusetzen. `GetSnapshotName`-Antworten besitzen keine eigene Snapshot-ID; diese wird allein über die ausgehende Request-ID und den beim Senden gespeicherten Abfrageparameter zugeordnet. Auch Antworten auf mehrere gleichzeitig laufende Abfragen bleiben dadurch korrekt zugeordnet.

Die tatsächliche Listenstruktur von `GiveListOfSnapshot` ist noch nicht durch einen Live-Paketmitschnitt bestätigt. Deshalb werden die Argumente als rohes JSON angezeigt und **weder Snapshot-IDs noch Namen aus Positionen geraten**. Falls die Antwort groß, ungewöhnlich verschachtelt oder syntaktisch unerwartet ist, bleiben Debugmeldungen und Rohbeobachtung zur weiteren Analyse nutzbar. Die Einzelnamen können bereits über `GetSnapshotName` gelesen werden.

## Sicherheit und Gültigkeit

- Nur eine zu einer offenen Abfrage passende `Give*`-Antwort setzt Snapshotvariablen. Ein `ResultCommand` alleine ist kein Snapshot-Readback.
- Ein fehlerhaft typisierter Antwortwert wird verworfen, ohne die korrelierte Abfrage vorzeitig als erfolgreich abzuschließen.
- Unbekannte oder doppelte Antworten dürfen vorhandene Snapshotnamen nicht überschreiben.
- Bei Verbindungsabbau oder Transportwechsel werden gespeicherte Snapshotwerte gelöscht. Bei weiter verbundener Sitzung kann ein Sessionwechsel Daten veralten lassen; bis ein eindeutiges Session-Changed-Signal verifiziert ist, sind erneute Abfragen ratsam.
- Die Namen sind pro Verbindung auf 512 Einträge und 2.048 Zeichen pro Eintrag begrenzt. Rohe Listenantworten sind auf 65.536 Zeichen begrenzt.
- Diese Funktion ist **lesend**. Sie führt keinen Recall, Store oder sonstige Snapshotmanipulation aus.

## Protokollnachweis

Registrierte Abfragen und erwartete Rückmeldungen aus dem ProLink-Reverse-Engineering:

| Abfrage | Antwort |
|---|---|
| `GetCurrentSnapshotNumber` | `GiveCurrentSnapshotNumber` |
| `GetSnapshotName` | `GiveSnapshotName` |
| `GetListOfSnapshots` | **`GiveListOfSnapshot`** (Singular) |

Die Binäranalyse bestätigt Adressen und Request-ID-Korrelation. Die Felder einer vollständigen Listenantwort und die endgültige Interpretation der Nummerierung benötigen weiterhin einen Live-Nachweis mit mehreren unterschiedlichen Snapshots.
