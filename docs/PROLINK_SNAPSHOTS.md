# SuperRack-Snapshots über ProLink

Die ProLink-Schnittstelle bietet lesende Abfragen der aktuellen Snapshotnummer, eines Snapshotnamens anhand seiner Provider-ID und der Snapshotliste. Die Companion-Actions `ProLink: Get current snapshot number`, `ProLink: Get snapshot name by provider ID` und `ProLink: Get snapshot list` verwenden diese Abfragen. Die hier dokumentierte Listenstruktur wurde am 20.10.2026 live mit SuperRack Performer beobachtet.

## Automatische Snapshotliste beim Verbinden

Sobald eine **neue ProLink-TCP-Verbindung** zu SuperRack aufgebaut wurde,
fordert das Modul automatisch mit `GetListOfSnapshots` die **vollständige**
Snapshotliste an. Die Anfrage erfolgt auch nach einem Reconnect; dafür muss
in Companion keine Action manuell ausgelöst werden. Der Empfänger ordnet die
Antwort über ihre Request-ID zu und verarbeitet die echte Adresse
`GiveListOfSnapshot` (Singular). Nachdem die vollständige Liste eingetroffen
ist, aktualisiert Companion die namensbasierten Recall-/Highlight-Auswahlfelder.

Wenn eine Verbindung getrennt wird, werden die beobachteten Snapshotnamen
und die Dropdown-Auswahl verworfen. Bis zur gültigen Listenantwort ist die
Auswahl leer. Ein Timeout meldet `unconfirmed` und ist **kein** Beweis dafür,
dass SuperRack die Abfrage abgelehnt hat. Die manuelle Action
`GetListOfSnapshots` bleibt zur späteren Aktualisierung, z. B. nach dem
Anlegen oder Umbenennen eines Snapshots, verfügbar. Die automatische
Abfrage selbst verändert keine Snapshots.

Statusvariable `prolink_snapshot_sync_status`:
`idle` (getrennt), `requesting` (Abfrage gesendet), `ready` (gültige Liste),
`refresh_required` (Schreibauftrag gesendet, Rückmeldung/Abfrage noch ausstehend),
`unconfirmed` (keine gültige Antwort im Request-Timeout) oder `send_failed`
(Übertragung der Anfrage gescheitert).

## Lesende Daten und Companion-Variablen

| Variable | Bedeutung |
|---|---|
| `prolink_snapshot_current_known` | Eine gültige Antwort auf `GetCurrentSnapshotNumber` wurde beobachtet |
| `prolink_snapshot_current_number_raw` | Signierte Ganzzahl aus `GiveCurrentSnapshotNumber` (Providersemantik noch zu prüfen) |
| `prolink_snapshot_last_name_target_id` | Provider-ID der letzten korrekt zugeordneten Namensabfrage |
| `prolink_snapshot_last_name` | Antwortname auf diese ID, auch ein leerer Name ist möglich |
| `prolink_snapshot_names_json` | JSON-Objekt bekannter Namen, nach Provider-ID indiziert |
| `prolink_snapshot_list_known` | Eine passende `GiveListOfSnapshot`-Antwort wurde empfangen |
| `prolink_snapshot_sync_status` | Status der automatisch gestarteten Listenabfrage |
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
- **Die Snapshotabfragen selbst sind ausschließlich lesend.** Recall und Highlight verwenden ihre bestehenden Freigabeschalter. Weitere explizite Schreib-Actions sind experimentell und unten mit ihren Schutzbedingungen dokumentiert.

## Protokollnachweis

Registrierte Abfragen und erwartete Rückmeldungen aus dem ProLink-Reverse-Engineering:

| Abfrage | Antwort |
|---|---|
| `GetCurrentSnapshotNumber` | `GiveCurrentSnapshotNumber` |
| `GetSnapshotName` | `GiveSnapshotName` |
| `GetListOfSnapshots` | **`GiveListOfSnapshot`** (Singular) |

Die Binäranalyse bestätigt Adressen und Request-ID-Korrelation. Das hier dokumentierte Listenformat wurde mit zwei Snapshots live beobachtet. Weitere Tests mit leerer Liste, vielen Snapshots und einer Sessionänderung sind sinnvoll; eine spontane Push-Benachrichtigung des aktuell ausgewählten Snapshots ist noch nicht belegt.

## Highlight vs. Recall

`HighlightSnapshot` **wählt** den Snapshot in der SuperRack-Snapshotliste aus,
ohne seine gespeicherten Audio-/Pluginparameter abzurufen. Der ausgewählte
Eintrag wird in der Snapshotliste blau markiert; der bereits abgerufene
Snapshot kann unabhängig davon grün markiert bleiben. Es kann deshalb völlig
normal sein, dass beim Ausführen von Highlight weder im Rack noch im Top-Bar-
Snapshot-Feld eine Änderung sichtbar ist. `RecallSnapshot` dagegen lädt den
Snapshot gemäß seinen Scope-/Recall-Safe-Einstellungen. Das Verhalten der
UI-Auswahl ist im Waves SuperRack Performer User Guide unter
„Snapshots List“ dokumentiert. `ResultCommand` mit Code 0 bestätigt die
Annahme einer Anweisung, **nicht** die visuell überprüfte Wirkung.

## Snapshotbearbeitung über ProLink (experimentell)

Zusätzlich zu den getrennten `RecallSnapshot`- und `HighlightSnapshot`-Actions bietet
P4 fünf **bewusst auszulösende Bearbeitungsaktionen für den aktuellen Snapshot**.
Vor **jedem** dieser fünf Schreibbefehle sendet Companion eine **neue**
`GetCurrentSnapshotNumber`-Anfrage. Die anschließende Aktion wartet asynchron
auf die zugehörige `GiveCurrentSnapshotNumber`-Antwort mit **derselben Request-ID**.
Ein gespeicherter Companion-Variablenwert und der zuletzt beobachtete
`currentNumber` sind ausdrücklich **keine** Grundlage für das Bearbeitungsziel.

### Actions und Argumente

| Companion-Action | ProLink-Befehl | OSC-Tags | Quelle / Ziel |
|---|---|---|---|
| Store current snapshot | `StoreSnapshot` | `,i` | Nur ausführen, wenn der frisch ermittelte aktuelle Snapshot in der Liste existiert; der Schreibbefehl selbst hat keine Ziel-ID |
| Duplicate current snapshot | `DuplicateSnapshot` | `,ii` | Die Listenposition der **frisch gelesenen** aktuellen Snapshot-ID; nur bei eindeutigen 0-basierten IDs/Positionen |
| Move current snapshot to position | `MoveSnapshot` | `,iii` | Quelle = frisch gelesener aktueller Snapshot; Zielposition explizit auswählbar |
| Rename current snapshot | `SetSnapshotName` | `,iiis` | ID = frisch gelesener aktueller Snapshot; neuer Name explizit angegeben |
| DELETE CURRENT snapshot | `DeleteSnapshot` | `,iii` | ID = frisch gelesener aktueller Snapshot; zwei ausdrückliche Freigaben erforderlich |

Die erste OSC-Ganzzahl ist stets die **Request-ID** des Schreibbefehls, nicht
die Snapshot-ID. Bei `SetSnapshotName` folgt auf die Request-ID die Anzahl der
Einträge (`1`), die Snapshot-ID und der Name als OSC-String. Bei
`DeleteSnapshot` folgen die Anzahl (`1`) und die Snapshot-ID. Dies sind flache
OSC-Argumente, keine OSC-Arrayklammern.

### Reihenfolge und Schutzbedingungen

1. Vor jeglicher Abfrage verlangt die Action `Explicit authorization = YES`.
   Der Löschbefehl erfordert darüber hinaus den exakt eingegebenen Text
   `DELETE CURRENT` – er kann den **aktiven** Snapshot entfernen.
2. Die aktive ProLink-Verbindung und die **vollständige** Liste müssen gültig
   sein (`prolink_snapshot_sync_status = ready`). Parallele Mutationen sind
   gesperrt.
3. Die Action sendet `GetCurrentSnapshotNumber`, speichert die neue Request-ID
   und wartet auf die passende Antwort. Eine andere `Give*`-Antwort oder eine
   Antwort mit anderer Request-ID wird nicht für die Aktion verwendet.
4. Bei Timeout (2.500 ms), Fehler-`ResultCommand`, Verbindungsverlust,
   Transportwechsel oder zwischenzeitlichem Austausch der Liste wird die
   Aktion **ohne Schreibbefehl** abgebrochen. Auch eine unbekannte aktuelle
   Snapshot-ID (beispielsweise `-1`) führt zum Abbruch.
5. Die aktuell abgefragte ID wird in der Liste nachgeschlagen. Für
   Duplicate/Move müssen Listenposition und ID eindeutig 0-basiert
   zusammenpassen; andernfalls werden diese beiden Aktionen vorsichtshalber
   gesperrt. Beim Move muss die Zielposition von der Quellposition abweichen.
6. Store, Duplicate und Rename nutzen nur diesen frisch ermittelten aktuellen
   Snapshot. Delete ist nur bei mindestens zwei Listeneinträgen und der
   zusätzlichen `DELETE CURRENT`-Bestätigung möglich.
7. Erst jetzt wird die Mutation gesendet. Bis zum passenden `ResultCommand`
   und einer frisch abgefragten Liste bleibt der Status `refresh_required`.
   Ein erfolgreicher ACK ist **keine** Bestätigung des tatsächlichen
   sichtbaren Zustands in SuperRack.

**Wichtige Protokollgrenze:** Die aktuelle Snapshot-ID wird **unmittelbar vor**
dem Schreiben abgefragt. ProLink bietet dafür aber keine atomare
„nur ausführen, falls Snapshot noch aktuell“-Transaktion. Wenn der Anwender
in SuperRack zwischen Antwort und Schreibbefehl umschaltet, lässt sich diese
Rest-Race-Condition nicht vollständig verhindern. Deshalb bleiben diese
Schreib-Actions experimentell und sind nicht ohne Live-Tests für produktive
Shows freizugeben.

`prolink_snapshot_last_edit_command` und
`prolink_snapshot_last_edit_status` (`pending`, `acknowledged`,
`rejected_or_unknown`, `unconfirmed`, `idle`) dokumentieren den Bearbeitungsweg.
Bei Disconnect werden ausstehende frische Current-Snapshot-Abfragen verworfen;
es gibt keinen Fallback auf einen Cache. Nach erfolgreichem ACK lädt das Modul
die vollständige Snapshotliste erneut; bei Store/Duplicate/Move/Delete wird
zusätzlich die aktuelle Snapshotnummer erneut abgefragt.

### Noch nicht freigegeben

`StoreSnapshotAs` und `InsertSnapshot` haben zwar registrierte OSC-Eingänge, ihre Nutzdaten bzw. Host-Semantik sind für eine sichere GUI-Aktion jedoch noch nicht ausreichend überprüft. Sie werden daher nicht als ausführbare Actions oder Wire-Encoder exponiert. Mehrere Snapshotnamen oder IDs in einer einzigen Mutation werden derzeit ebenfalls bewusst nicht angeboten.

### Mindest-Livetest vor Bühneneinsatz

1. Eine Kopie einer unkritischen Session mit drei Snapshots verwenden.
2. Vollständige Liste und aktuelle Snapshotnummer abrufen; IDs und Positionen abgleichen.
3. Jede Mutation separat ausführen und die exakte `ResultCommand`-Antwort sowie die automatisch folgende `GiveListOfSnapshot` prüfen.
4. Für jede Bearbeitungsaktion die vorangestellte `GetCurrentSnapshotNumber`-Abfrage und korrelierte `GiveCurrentSnapshotNumber`-Antwort nachweisen. Nach `Duplicate`/`Move`/`Delete` Namen, Reihenfolge, aktive Snapshotnummer und gespeicherten Effektzustand manuell mit der SuperRack-Oberfläche vergleichen.
5. Negative Fälle prüfen: keine Freigabe, fehlende/ungültige aktuelle ID, fehlende Liste, ausbleibende oder fremde Antwort, Reconnect, parallele Aktionen, unzusammenhängende IDs und Löschbestätigung.

