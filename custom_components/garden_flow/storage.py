from __future__ import annotations

from collections.abc import Iterable
import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import STORAGE_KEY, STORAGE_VERSION
from .models import Program

_LOGGER = logging.getLogger(__name__)


class GardenFlowStore:
    """Persist programs in Home Assistant storage."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store = Store[dict[str, Any]](hass, STORAGE_VERSION, STORAGE_KEY)
        self._programs: dict[str, Program] = {}

    async def async_load(self) -> None:
        loaded = await self._store.async_load()
        if not isinstance(loaded, dict):
            self._programs = {}
            return

        raw_programs = loaded.get("programs", [])
        if not isinstance(raw_programs, list):
            _LOGGER.warning("Ignoring invalid Garden Flow storage payload")
            self._programs = {}
            return

        programs: dict[str, Program] = {}
        for raw_program in raw_programs:
            try:
                program = Program.from_dict(raw_program)
            except ValueError as err:
                _LOGGER.warning("Skipping invalid stored Garden Flow program: %s", err)
                continue
            programs[program.id] = program

        self._programs = programs

    def list_programs(self) -> list[Program]:
        return sorted(self._programs.values(), key=lambda program: program.name.lower())

    def get_program(self, program_id: str) -> Program | None:
        return self._programs.get(program_id)

    async def async_upsert_program(self, program: Program) -> None:
        self._programs[program.id] = program
        await self._async_save()

    async def async_delete_program(self, program_id: str) -> bool:
        removed = self._programs.pop(program_id, None)
        if removed is None:
            return False
        await self._async_save()
        return True

    def iter_programs(self) -> Iterable[Program]:
        return self._programs.values()

    async def _async_save(self) -> None:
        await self._store.async_save(
            {"programs": [program.as_dict() for program in self.list_programs()]}
        )
