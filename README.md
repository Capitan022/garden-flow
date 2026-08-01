# Garden Flow

Garden Flow is a public Home Assistant custom integration for visually scheduling
outdoor automations such as irrigation valves, garden lights, switches, fans,
scenes, and scripts.

This repository ships:

- a Home Assistant custom integration
- a sidebar panel for editing programs visually
- a Lovelace custom card for dashboards
- a local scheduler stored in Home Assistant storage
- service actions to run, stop, and reload programs

## Status

This is an MVP intended to get the project on GitHub quickly and give us a real
base to iterate on.

Current capabilities:

- weekly schedules with a fixed start time
- visual timeline preview over 24 hours
- sequential or overlapping blocks
- support for `light`, `switch`, `valve`, `scene`, `script`, `cover`, `fan`,
  and `input_boolean`
- manual run and stop from the panel or through Home Assistant services
- dashboard card to monitor and run a program from Lovelace

Current limitations:

- no drag and drop block editing yet
- no sunrise/sunset offsets yet
- no import/export yet
- advanced service data is supported in the backend model but not exposed in
  the MVP panel

## Project Layout

```text
custom_components/garden_flow/
  __init__.py
  api.py
  config_flow.py
  const.py
  manifest.json
  models.py
  panel/garden-flow-panel.js
  scheduler.py
  services.yaml
  storage.py
  translations/en.json
  translations/es.json
```

## Installation

### Manual

1. Copy `custom_components/garden_flow` into your Home Assistant config folder.
2. Restart Home Assistant.
3. Add the integration from `Settings -> Devices & Services -> Add Integration`.
4. Search for `Garden Flow`.
5. Open the new `Garden Flow` panel in the sidebar.

### HACS

Once this repository is public, add it as a custom repository in HACS and
install it as an integration.

## Services

Garden Flow registers these service actions:

- `garden_flow.run_program`
- `garden_flow.stop_program`
- `garden_flow.reload`

Example:

```yaml
service: garden_flow.run_program
data:
  program_id: morning_irrigation
```

## Dashboard Card

The integration auto-loads a Lovelace custom card named
`custom:garden-flow-program-card`, so you do not need to register a separate
dashboard resource manually.

Example:

```yaml
type: custom:garden-flow-program-card
title: Riego jardin
program_id: morning_irrigation
show_blocks: true
compact: false
```

If `program_id` is omitted, the card shows the first available program.

## Example Program Model

```json
{
  "id": "morning_irrigation",
  "name": "Morning irrigation",
  "enabled": true,
  "start_time": "06:00",
  "weekdays": [0, 2, 4],
  "blocks": [
    {
      "id": "zone_1",
      "label": "Front lawn",
      "entity_id": "valve.front_lawn",
      "offset_minutes": 0,
      "duration_minutes": 12,
      "start_service": "valve.open_valve",
      "stop_service": "valve.close_valve",
      "color": "#4f7f52"
    },
    {
      "id": "zone_2",
      "label": "Garden beds",
      "entity_id": "valve.garden_beds",
      "offset_minutes": 12,
      "duration_minutes": 10,
      "start_service": "valve.open_valve",
      "stop_service": "valve.close_valve",
      "color": "#c86c3d"
    }
  ]
}
```

## Development Notes

- The integration uses Home Assistant storage, not YAML, for persisted programs.
- The sidebar panel is registered through `panel_custom`.
- The panel frontend talks to Home Assistant over custom WebSocket commands.

## Publish Checklist

Before the first public release:

1. Add screenshots or a demo GIF.
2. Decide whether to keep the panel admin-only.
3. Add drag and drop editing if we want a more ambitious visual editor.

## References

This MVP follows current Home Assistant developer guidance for:

- custom integration file structure
- custom integration localization
- extending the WebSocket API
- custom panels

Official references:

- [Integration file structure](https://developers.home-assistant.io/docs/creating_integration_file_structure/)
- [Custom integration localization](https://developers.home-assistant.io/docs/internationalization/custom_integration/)
- [Extending the WebSocket API](https://developers.home-assistant.io/docs/frontend/extending/websocket-api/)
- [Creating custom panels](https://developers.home-assistant.io/docs/frontend/custom-ui/creating-custom-panels/)
- [Registering static paths](https://developers.home-assistant.io/blog/2024/06/18/async_register_static_paths/)
