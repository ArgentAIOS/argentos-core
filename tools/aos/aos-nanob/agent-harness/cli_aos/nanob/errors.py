class CliError(RuntimeError):
    def __init__(self, code: str, message: str, exit_code: int, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.exit_code = exit_code
        self.details = details or {}
