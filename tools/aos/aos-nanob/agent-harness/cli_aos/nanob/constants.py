from pathlib import Path

MODE_ORDER = ["readonly", "write", "full", "admin"]
PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"

NANOB_DIR = Path.home() / ".argentos" / "nanob"
OUTPUT_DIR = NANOB_DIR / "output"
PROMPTS_DIR = NANOB_DIR / "prompts"
SESSIONS_DIR = NANOB_DIR / "sessions"

FLASH_MODEL = "gemini-2.5-flash-image"
PRO_MODEL = "imagen-4.0-generate-001"

ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]

# Size presets mapped to pixel dimensions per aspect ratio
SIZE_MAP = {
    "1:1": {"1K": (1024, 1024), "2K": (2048, 2048), "4K": (4096, 4096)},
    "2:3": {"1K": (832, 1248), "2K": (1664, 2496), "4K": (2732, 4096)},
    "3:2": {"1K": (1248, 832), "2K": (2496, 1664), "4K": (4096, 2732)},
    "3:4": {"1K": (896, 1152), "2K": (1536, 2048), "4K": (3072, 4096)},
    "4:3": {"1K": (1152, 896), "2K": (2048, 1536), "4K": (4096, 3072)},
    "4:5": {"1K": (896, 1120), "2K": (1792, 2240), "4K": (3280, 4096)},
    "5:4": {"1K": (1120, 896), "2K": (2240, 1792), "4K": (4096, 3280)},
    "9:16": {"1K": (768, 1344), "2K": (1152, 2048), "4K": (2304, 4096)},
    "16:9": {"1K": (1344, 768), "2K": (2048, 1152), "4K": (4096, 2304)},
    "21:9": {"1K": (1344, 576), "2K": (2688, 1152), "4K": (4096, 1756)},
}

STYLES = [
    "photorealistic",
    "illustration",
    "3d-render",
    "anime",
    "watercolor",
    "oil-painting",
    "pixel-art",
    "sketch",
]

LIGHTING = [
    "natural",
    "studio",
    "dramatic",
    "neon",
    "golden-hour",
    "blue-hour",
    "backlit",
    "rim",
]

CAMERA_ANGLES = [
    "wide",
    "medium",
    "close-up",
    "extreme-close-up",
    "overhead",
    "low-angle",
    "dutch-angle",
]

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_USAGE = 2
EXIT_PERMISSION = 3
