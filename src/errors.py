class ApiError(Exception):
    """Rendered as {error:{code,message}} with the given HTTP status."""

    def __init__(self, status: int, code: str, message: str, **extra):
        super().__init__(message)
        self.status, self.code, self.message, self.extra = status, code, message, extra  # extra: more keys inside `error`
