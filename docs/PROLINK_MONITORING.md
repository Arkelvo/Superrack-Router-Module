# ProLink – Betriebsmonitoring und Diagnose

## Zweck und Evidenz

Diese Monitoringfunktionen ergänzen die lesenden Waves-SuperRack-ProLink-Schnittstellen.

- **LIVE** (Startup-Logs): `NotifySyncStatus`, `NotifyIOBoxStatus`, `NotifySGSStatus`, `NotifyRemoteOperation`, `NotifySnapshotDirty`; Controller- und Rack-Notifications.
- **STATIC** (REA-Analyse): `GetCPUUsage` → `GiveCPUUsage`, `GetSessionDirtyState` → `GiveSessionDirtyState`; weitere `NotifyAudioStatus`, `NotifyDAWStatus`, `NotifyMirrorStatus`, `NotifySGSInfo`.
- **UNKNOWN**: Das exakte Antwortschema von `GiveCPUUsage` und `GiveSessionDirtyState`. Rohwerte werden daher weder als Prozentwerte noch als bestätigte boolesche Sessionzustände interpretiert. Für die zusätzlichen Notifications ist nur ihr Protokollname, nicht jedes Feldsemantik belegt.

## Lebenszyklus

Beim neu aufgebauten ProLink-TCP-Peer werden weiterhin die vollständige Snapshotliste und die Controller-Subscription angefordert. Zusätzlich laufen zwei **unabhängig korrelierte, lesende Abfragen**:

| Anfrage | Antwort | Intervall | Semantik |
|---|---|---:|---|
| `GetCPUUsage` | `GiveCPUUsage` | sofort, dann alle 15 s | Rohdaten, unbekannte Einheit |
| `GetSessionDirtyState` | `GiveSessionDirtyState` | sofort, dann alle 15 s | Rohdaten, genaue Antwortform noch offen |

Es gibt maximal eine offene automatische Anfrage **pro Get-Befehl**; weitere Intervalle erzeugen keine Queue. Die vorhandene Request-Korrelation besitzt 2,5 s Timeout. `succeeded` für ein Getter-Result ersetzt keine `Give*`-Antwort.

Bei **Disconnect/Transportwechsel**: Polling stoppen, Timer entfernen, offene Requests verwerfen, ermittelte Daten leeren. Nach Reconnect frischer Start. Wiederholte `connected`-Ereignisse derselben Verbindung erzeugen keine zweite Polling-Schleife.

## Companion-Variablen

| Variable(n) | Inhalt |
|---|---|
| `prolink_monitor_connection_count` | Anzahl etablierter TCP-Peers seit Modulstart, erster Peer = 1 |
| `prolink_monitor_connected_since_ms` | Beginn der aktuellen Verbindung (Unix ms), sonst leer |
| `prolink_monitor_cpu_status` | `idle`, `requesting`, `received`, `unconfirmed`, `send_failed`, `rejected_or_unknown` |
| `prolink_monitor_cpu_known` | Gültige Antwort in der aktuellen Verbindung empfangen |
| `prolink_monitor_cpu_args_json` | Komplette `GiveCPUUsage`-Argumente **ohne** Request-ID, JSON-Array |
| `prolink_monitor_cpu_last_seen_ms` | Zeitpunkt der letzten gültigen CPU-Antwort |
| `prolink_monitor_session_dirty_*` | Gleiches Schema (`status`, `known`, `args_json`, `last_seen_ms`) für Session-Dirty-Getter |
| `prolink_monitor_last_status_change_ms` | Letzte tatsächliche Änderung einer beobachteten `Notify*`-Statusvariable; **kein Heartbeat** |
| `prolink_audio_status_raw`, `prolink_daw_status_raw`, `prolink_mirror_status_raw`, `prolink_sgs_info_raw` | Gegebenenfalls empfangene skalare oder JSON-Rohdaten aus den gleichnamigen Notifications |
| `prolink_sync_status`, `prolink_iobox_status`, `prolink_sgs_status`, `prolink_remote_operation`, `prolink_snapshot_dirty`, `prolink_session_dirty` | Bereits vorhandene, unverändert rohe Werte |

Empfangene Getterdaten bleiben innerhalb der Verbindung sichtbar, bis sie durch eine spätere Antwort ersetzt werden. Der `*_status` zeigt zusätzlich, ob die **neueste** Abfrage noch aussteht oder unbestätigt ist. Für eine eigene „frisch“-Schwelle den Zeitstempel beachten. Ohne ProLink werden Rohdaten und Known-Flags zurückgesetzt.

## Companion-Feedbacks

| ID | Wahr genau dann, wenn ... |
|---|---|
| `prolink_session_dirty_observed` | `NotifySessionDirty` innerhalb der aktuellen Verbindung explizit `true` meldete |
| `prolink_snapshot_dirty_observed` | `NotifySnapshotDirty` explizit `true` meldete |
| `prolink_iobox_true_observed` | `NotifyIOBoxStatus` explizit `true` meldete (ohne implizite Gesundheitsbewertung) |
| `prolink_sgs_true_observed` | `NotifySGSStatus` explizit `true` meldete (ohne implizite Gesundheitsbewertung) |
| `prolink_monitor_cpu_observed` | Letzter CPU-Getter wurde innerhalb der Verbindung tatsächlich beantwortet |
| `prolink_monitor_query_issue` | Eine Monitoring-Anfrage hat keinen positiven Antwortabschluss: Sendefehler, Timeout oder Abweisung |

Die Feedbacks `prolink_connected`, `prolink_controller_observed`, `prolink_rack_muted` und `prolink_rack_on` bleiben unverändert verfügbar. Bei Trennung zeigen die neuen Feedbacks **false**, nicht „SuperRack ist gesund/dirty=false“.

## Diagnose und Fehlersuche

Das vorhandene Debugging wird beibehalten: Controller-Deltas, Rackänderungen, `ResultCommand`, fehlerhafte Replies und andere OSC-Nachrichten. Die Monitoringabfragen sind **read-only**; sie ändern weder Session noch Audioeinstellungen und senden keine anderen Befehle.

Wenn `prolink_monitor_cpu_status = unconfirmed`, im `debug`-Log nach `GiveCPUUsage` suchen. Bei vorhandener Antwort das rohe `args`-Array bereitstellen, um das Schema in einem späteren Schritt anhand echter Daten zu validieren. CPU-Werte in Companion vorerst nicht als Prozent anzeigen.
