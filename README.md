# IONIQ 5 Dashboard Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/hacs/integration)

Custom Lovelace-Karte für Home Assistant, die die Fahrdaten eines Hyundai
IONIQ 5 (Strecke, Verbrauch, Rekuperation, Effizienz) als Balken- und
Liniendiagramme darstellt. Implementiert als eigenständige LitElement-Card
(kein Build-Schritt nötig). Die Karte ist eine einzige, in sich geschlossene
Datei (LitElement und Chart.js sind eingebettet) – keine externen
Abhängigkeiten, keine separaten Dateien zu installieren.

## Voraussetzung

Eine Sensor-Entity, deren Attribute für jeden Tag (Schlüssel im Format
`YYYY-MM-DD`) ein Objekt mit folgenden Feldern enthalten:

| Feld                              | Bedeutung                          |
|-----------------------------------|-------------------------------------|
| `distance`                        | Gefahrene Strecke (km)             |
| `total_consumed`                  | Gesamtverbrauch (Wh)                |
| `regenerated_energy`              | Rekuperierte Energie (Wh)           |
| `engine_consumption`              | Verbrauch Antrieb (Wh)              |
| `climate_consumption`             | Verbrauch Klima (Wh)                |
| `onboard_electronics_consumption` | Verbrauch Bordelektronik (Wh)       |

## Installation

### Über HACS (empfohlen)

1. HACS → Frontend → Menü (⋮) → **Benutzerdefinierte Repositories**
2. Repository-URL dieses Projekts eintragen, Kategorie **Plugin** wählen
3. "IONIQ 5 Dashboard Card" installieren
4. Home Assistant neu laden (HACS trägt die Lovelace-Ressource automatisch ein)

### Manuell

1. `ioniq5-dashboard-card.js` nach `/config/www/ioniq5-dashboard/` kopieren
2. Einstellungen → Dashboards → Ressourcen → Hinzufügen
   URL: `/local/ioniq5-dashboard/ioniq5-dashboard-card.js`, Typ: JavaScript-Modul
3. Browser hart neu laden (Strg/Cmd+Umschalt+R)

## Verwendung

```yaml
type: custom:ioniq5-dashboard-card
entity: sensor.DEIN_SENSOR_NAME
title: IONIQ 5 Fahrdaten     # optional
```

## Lizenz

MIT, siehe [LICENSE](LICENSE).
