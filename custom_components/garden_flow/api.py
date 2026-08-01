from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv

from .const import (
    DATA_RUNTIME,
    DATA_SERVICES_REGISTERED,
    DATA_WS_REGISTERED,
    DOMAIN,
    SERVICE_RELOAD,
    SERVICE_RUN_PROGRAM,
    SERVICE_STOP_PROGRAM,
    SUPPORTED_DOMAINS,
)
from .models import Program

_LOGGER = logging.getLogger(__name__)


def async_register_websocket_commands(hass: HomeAssistant) -> None:
    if hass.data.get(DATA_WS_REGISTERED):
        return

    websocket_api.async_register_command(hass, ws_list_state)
    websocket_api.async_register_command(hass, ws_save_program)
    websocket_api.async_register_command(hass, ws_delete_program)
    websocket_api.async_register_command(hass, ws_run_program)
    websocket_api.async_register_command(hass, ws_stop_program)
    websocket_api.async_register_command(hass, ws_reload)
    hass.data[DATA_WS_REGISTERED] = True


def async_register_services(hass: HomeAssistant) -> None:
    if hass.data.get(DATA_SERVICES_REGISTERED):
        return

    async def _run_program(call: ServiceCall) -> None:
        runtime = _require_runtime(hass)
        program_id = call.data["program_id"]
        try:
            await runtime.scheduler.async_run_program(program_id, source="service")
        except ValueError as err:
            raise ServiceValidationError(str(err)) from err

    async def _stop_program(call: ServiceCall) -> None:
        runtime = _require_runtime(hass)
        stopped = await runtime.scheduler.async_stop_program(call.data["program_id"])
        if not stopped:
            raise ServiceValidationError("Program is not running")

    async def _reload(_call: ServiceCall) -> None:
        runtime = _require_runtime(hass)
        await runtime.scheduler.async_reload()

    hass.services.async_register(
        DOMAIN,
        SERVICE_RUN_PROGRAM,
        _run_program,
        schema=vol.Schema({vol.Required("program_id"): cv.string}),
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_STOP_PROGRAM,
        _stop_program,
        schema=vol.Schema({vol.Required("program_id"): cv.string}),
    )
    hass.services.async_register(DOMAIN, SERVICE_RELOAD, _reload)
    hass.data[DATA_SERVICES_REGISTERED] = True


def async_unregister_services(hass: HomeAssistant) -> None:
    for service_name in (SERVICE_RUN_PROGRAM, SERVICE_STOP_PROGRAM, SERVICE_RELOAD):
        if hass.services.has_service(DOMAIN, service_name):
            hass.services.async_remove(DOMAIN, service_name)
    hass.data.pop(DATA_SERVICES_REGISTERED, None)


def _require_runtime(hass: HomeAssistant) -> Any:
    runtime = hass.data.get(DATA_RUNTIME)
    if runtime is None:
        raise HomeAssistantError("Garden Flow is not configured")
    return runtime


def _default_services(entity_domain: str) -> tuple[str, str | None]:
    if entity_domain == "cover":
        return "cover.open_cover", "cover.close_cover"
    if entity_domain == "fan":
        return "fan.turn_on", "fan.turn_off"
    if entity_domain == "input_boolean":
        return "input_boolean.turn_on", "input_boolean.turn_off"
    if entity_domain == "light":
        return "light.turn_on", "light.turn_off"
    if entity_domain == "scene":
        return "scene.turn_on", None
    if entity_domain == "script":
        return "script.turn_on", "script.turn_off"
    if entity_domain == "switch":
        return "switch.turn_on", "switch.turn_off"
    if entity_domain == "valve":
        return "valve.open_valve", "valve.close_valve"
    return f"{entity_domain}.turn_on", f"{entity_domain}.turn_off"


def _supported_entities(hass: HomeAssistant) -> list[dict[str, Any]]:
    entities: list[dict[str, Any]] = []
    for state in hass.states.async_all():
        domain = state.entity_id.split(".", 1)[0]
        if domain not in SUPPORTED_DOMAINS:
            continue

        default_start_service, default_stop_service = _default_services(domain)
        entities.append(
            {
                "entity_id": state.entity_id,
                "name": state.attributes.get("friendly_name", state.entity_id),
                "domain": domain,
                "state": state.state,
                "icon": state.attributes.get("icon"),
                "default_start_service": default_start_service,
                "default_stop_service": default_stop_service,
            }
        )

    return sorted(entities, key=lambda entity: entity["name"].lower())


async def _async_build_state(hass: HomeAssistant) -> dict[str, Any]:
    runtime = _require_runtime(hass)
    return {
        "programs": [program.as_dict() for program in runtime.storage.list_programs()],
        "entities": _supported_entities(hass),
        "running_program_ids": runtime.scheduler.running_program_ids(),
        "next_runs": runtime.scheduler.next_runs(),
    }


@websocket_api.websocket_command({"type": "garden_flow/list_state"})
@websocket_api.async_response
async def ws_list_state(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    connection.send_result(msg["id"], await _async_build_state(hass))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "garden_flow/save_program",
        vol.Required("program"): dict,
    }
)
@websocket_api.async_response
async def ws_save_program(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    runtime = _require_runtime(hass)
    try:
        program = Program.from_dict(msg["program"])
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_program", str(err))
        return

    await runtime.storage.async_upsert_program(program)
    await runtime.scheduler.async_reload()
    connection.send_result(msg["id"], await _async_build_state(hass))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "garden_flow/delete_program",
        vol.Required("program_id"): cv.string,
    }
)
@websocket_api.async_response
async def ws_delete_program(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    runtime = _require_runtime(hass)
    await runtime.scheduler.async_stop_program(msg["program_id"])
    deleted = await runtime.storage.async_delete_program(msg["program_id"])
    if not deleted:
        connection.send_error(msg["id"], "not_found", "Program not found")
        return

    await runtime.scheduler.async_reload()
    connection.send_result(msg["id"], await _async_build_state(hass))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "garden_flow/run_program",
        vol.Required("program_id"): cv.string,
    }
)
@websocket_api.async_response
async def ws_run_program(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    runtime = _require_runtime(hass)
    try:
        await runtime.scheduler.async_run_program(msg["program_id"], source="panel")
    except ValueError as err:
        connection.send_error(msg["id"], "run_failed", str(err))
        return

    connection.send_result(msg["id"], await _async_build_state(hass))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "garden_flow/stop_program",
        vol.Required("program_id"): cv.string,
    }
)
@websocket_api.async_response
async def ws_stop_program(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    runtime = _require_runtime(hass)
    stopped = await runtime.scheduler.async_stop_program(msg["program_id"])
    if not stopped:
        connection.send_error(msg["id"], "not_running", "Program is not running")
        return

    connection.send_result(msg["id"], await _async_build_state(hass))


@websocket_api.websocket_command({"type": "garden_flow/reload"})
@websocket_api.async_response
async def ws_reload(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    runtime = _require_runtime(hass)
    await runtime.scheduler.async_reload()
    connection.send_result(msg["id"], await _async_build_state(hass))
