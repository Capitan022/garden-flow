DOMAIN = "garden_flow"
NAME = "Garden Flow"
VERSION = "0.1.0"

DEFAULT_PROGRAM_START_TIME = "06:00"
MAX_PROGRAM_MINUTES = 24 * 60

STORAGE_KEY = f"{DOMAIN}_programs"
STORAGE_VERSION = 1

PANEL_TITLE = "Garden Flow"
PANEL_ICON = "mdi:sprinkler-variant"
PANEL_URL_PATH = "garden-flow"
PANEL_COMPONENT_NAME = "garden-flow-panel"
PANEL_STATIC_URL = "/garden_flow_panel"
PANEL_ENTRYPOINT = "garden-flow-panel.js"
CARD_ENTRYPOINT = "garden-flow-card.js"

DATA_RUNTIME = f"{DOMAIN}_runtime"
DATA_STATIC_REGISTERED = f"{DOMAIN}_static_registered"
DATA_WS_REGISTERED = f"{DOMAIN}_ws_registered"
DATA_SERVICES_REGISTERED = f"{DOMAIN}_services_registered"

SERVICE_RUN_PROGRAM = "run_program"
SERVICE_STOP_PROGRAM = "stop_program"
SERVICE_RELOAD = "reload"

SUPPORTED_DOMAINS = (
    "cover",
    "fan",
    "input_boolean",
    "light",
    "scene",
    "script",
    "switch",
    "valve",
)
