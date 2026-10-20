# ProLink: Befehle, Abfragen und Rückmeldungen

Dieses Dokument beschreibt die unterstützte Kommunikation zwischen dem Companion-Modul und Waves SuperRack Performer. Die ProLink-Schnittstelle wurde aus binären Quellen rekonstruiert; Teile der Semantik wurden zusätzlich durch reale SuperRack-Meldungen bestätigt. Die Dokumentation ist eine Funktionsreferenz, keine einmalige Entwicklungsanleitung.

## Nachrichtenklassen

| Klasse | Beispiel | Identität / Bedeutung |
|---|---|---|
| Setter / Navigation | `ShowRackByID`, `NavigatePlugin`, `ChangeControllerValue` | Gesendete Request-ID (OSC `i`) und befehlsspezifische Parameter |
| Getter | `GetRackName`, `GetCurrentSnapshotNumber`, `GetListOfSnapshots` | Gesendete Request-ID; erwartete Antwort ist `Give*` |
| Antwort auf Getter | `GiveRackName`, `GiveCurrentSnapshotNumber`, `GiveListOfSnapshot` | Erste Position ist die Request-ID; restlicher Payload ist befehlsspezifisch |
| Befehlsresultat | `ResultCommand` | Request-ID, int32-Resultcode, Text; ist keine Garantie für einen nachfolgenden UI-/DSP-Zustand |
| Asynchrone Meldung | `NotifyRacksConfigChanged`, `NotifyControllerValue` | Ohne zugehörige Request-ID; beschreibt einen beobachteten Zustand |

**Wichtig:** Ein erfolgreicher Getter erzeugt gemäß statischer Analyse nicht zwingend einen zusätzlichen `ResultCommand(0)`. Eine erfolgreiche `Give*`-Antwort erfüllt deshalb die Abfrage. Bei Schreibbefehlen wird weiterhin der zugehörige `ResultCommand` beobachtet. Die Reihenfolge verschiedener Meldungen wird nicht vorausgesetzt.

## Erwartete Antworten für implementierte Getter

| Anfrage | Antwortadresse |
|---|---|
| `GetNumRacks` | `GiveNumRacks` |
| `GetRackName` | `GiveRackName` |
| `GetRacksInfo` | `GiveRackInfo` |
| `GetCurrentSnapshotNumber` | `GiveCurrentSnapshotNumber` |
| `GetSnapshotName` | `GiveSnapshotName` |
| `GetListOfSnapshots` | **`GiveListOfSnapshot`** (Singular) |
| `GetCPUUsage` | `GiveCPUUsage` |
| `GetSessionDirtyState` | `GiveSessionDirtyState` |

Die Zuordnung stammt aus statisch identifizierten Senderadressen. Nur die inzwischen **live verifizierten Snapshot-Antwortschemata** werden zusätzlich strukturiert verarbeitet: `GiveCurrentSnapshotNumber` als signierter Integer, `GiveSnapshotName` als String und `GiveListOfSnapshot` als `[count,id,name,...]` nach der Request-ID. Andere `Give*`-Antworten bleiben im Modul weiterhin als Rohdaten verfügbar, bis ihr Schema belegt ist. Snapshot-Provider-ID und Snapshot-Hot-Slot sind nicht gleichzusetzen.

## Lebenszyklus einer Abfrage

1. Der ProLink-Service vergibt eine signierte 32-Bit-Request-ID und sendet die kodierte Anfrage.
2. Die Beobachtungsschicht registriert den erwarteten `Give*`-Namen. Mehrere parallele Requests lassen sich über die ID unterscheiden.
3. Bei `Give*` wird **nur** dann eine Anfrage als zugeordnet betrachtet, wenn ID **und** Antwortadresse zur erwarteten Anfrage passen. Die Rohargumente stehen in `prolink_last_reply_args`.
4. Eine ausbleibende Antwort wird nach einem Timeout als `unconfirmed` markiert; dies ist weder ein sicherer Fehler noch ein Erfolg.
5. Bei Disconnect werden ausstehende Requests und beobachtete Zustände zurückgesetzt. Verspätete Antworten dürfen nicht einer späteren Verbindung zugeordnet werden.

Die derzeitige requestbezogene Prüfung ist ein diagnostischer Mechanismus; sie ist keine Garantie für strikt deterministische SuperRack-Abarbeitung. Der Code verwirft Duplikate und fremde IDs, statt sie als Erfolg zu interpretieren.

## Companion-Variablen

| Variable | Bedeutung |
|---|---|
| `prolink_last_reply_command` | Zuletzt empfangene `Give*`-Adresse (ohne Präfix) |
| `prolink_last_reply_sequence` | Request-ID der zuletzt empfangenen Antwort |
| `prolink_last_reply_args` | Antwortparameter ohne ID, als JSON |
| `prolink_last_reply_matched` | Antwort-ID **und** Antwortname passen zu einem offenen Request |
| `prolink_last_reply_request` | Ursprünglicher Befehl, sofern eindeutig zugeordnet |
| `prolink_command_pending` | Offene Abfragen oder Befehlsresultate; keine Zahl laufender DSP-Vorgänge |
| `prolink_last_command_status` | `pending`, `replied`, `succeeded`, `rejected_or_unknown`, `unconfirmed` oder leer |
| `prolink_last_ack_sequence` | Zuletzt zugeordnetes `ResultCommand` (kann bei Getter-Abfragen leer bleiben) |

Racknamen, Rackzustände, Touch-and-Turn-Werte und sonstige asynchrone Statuswerte sind weiterhin eigenständige Beobachtungen. Ein lokaler `Route Rack`-Send ist **kein** bestätigter aktiver Rackzustand.

## Sicherheit, Datenhaltung und Diagnostik

- Der rekonstruierte ProLink-Transport besitzt keine etablierte Verschlüsselung oder Authentifizierung. Nur in vertrauenswürdigen lokalen Kontrollnetzen betreiben.
- Rohantworten nicht als Script oder Formatstring ausführen. Debug-Daten sind Diagnoseinformationen und können beliebige Sitzungstitel enthalten.
- Bei erneutem Verbinden alte Zustände, Request-Timer und vermeintliche Bestätigungen zurücksetzen.
- Im Debugmodus bleiben Protokollpfade, Empfangsargumente, `ResultCommand` und Controller-/Rack-Deltas nachvollziehbar; unbekannte Pakete sind kein Anlass für die Ausführung nicht dokumentierter Aktionen.

**Referenzen:** REA-Analyse `prolink-protocol-reference.md`, `prolink-feedback-reference.md` und `prolink-connection-state-machine.md` (Evidenz F001–F064); Modulimplementierung `lib/prolink-codec.js`, `lib/prolink-osc.js`, `lib/prolink-observations.js` und `lib/prolink-request-tracker.js`.
