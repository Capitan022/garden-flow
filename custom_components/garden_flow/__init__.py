from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType

from .api import (
    async_register_services,
    async_register_websocket_commands,
    async_unregister_services,
)
from .const import (
    CARD_ENTRYPOINT,
    DATA_RUNTIME,
    DATA_STATIC_REGISTERED,
    DOMAIN,
    PANEL_COMPONENT_NAME,
    PANEL_ENTRYPOINT,
    PANEL_ICON,
    PANEL_STATIC_URL,
    PANEL_TITLE,
    PANEL_URL_PATH,
    VERSION,
)
from .scheduler import GardenFlowScheduler
from .storage import GardenFlowStore


@dataclass(slots=True)
class GardenFlowRuntimeData:
    storage: GardenFlowStore
    scheduler: GardenFlowScheduler


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    await _async_register_static_assets(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    await _async_register_static_assets(hass)

    storage = GardenFlowStore(hass)
    await storage.async_load()

    scheduler = GardenFlowScheduler(hass, storage)
    await scheduler.async_reload()

    runtime = GardenFlowRuntimeData(storage=storage, scheduler=scheduler)
    entry.runtime_data = runtime
    hass.data[DATA_RUNTIME] = runtime

    async_register_websocket_commands(hass)
    async_register_services(hass)
    await _async_register_panel(hass)
    frontend.add_extra_js_url(hass, f"{PANEL_STATIC_URL}/{CARD_ENTRYPOINT}?v={VERSION}")
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    runtime: GardenFlowRuntimeData = entry.runtime_data
    await runtime.scheduler.async_unload()
    hass.data.pop(DATA_RUNTIME, None)

    if frontend.async_panel_exists(hass, PANEL_URL_PATH):
        frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)

    frontend.remove_extra_js_url(hass, f"{PANEL_STATIC_URL}/{CARD_ENTRYPOINT}?v={VERSION}")
    async_unregister_services(hass)
    return True


async def _async_register_static_assets(hass: HomeAssistant) -> None:
    if not hass.data.get(DATA_STATIC_REGISTERED):
        panel_path = Path(__file__).parent / "panel"
        await hass.http.async_register_static_paths(
            [StaticPathConfig(PANEL_STATIC_URL, str(panel_path), False)]
        )
        hass.data[DATA_STATIC_REGISTERED] = True


async def _async_register_panel(hass: HomeAssistant) -> None:
    await _async_register_static_assets(hass)

    if frontend.async_panel_exists(hass, PANEL_URL_PATH):
        return

    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name=PANEL_COMPONENT_NAME,
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        module_url=f"{PANEL_STATIC_URL}/{PANEL_ENTRYPOINT}?v={VERSION}",
        embed_iframe=False,
        require_admin=True,
    )
