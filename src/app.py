from fastapi import FastAPI

app = FastAPI(title="LARIS")


@app.get("/health")
def health():
    return {"status": "ok"}
