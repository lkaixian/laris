class ApiError(Exception):
    """Rendered as {error:{code,message}} with the given HTTP status."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message
