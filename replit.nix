{ pkgs }: {
  deps = [
    pkgs.python311
    pkgs.nodejs_20
    pkgs.postgresql_16 # provides psql for run.sh bootstrap
    pkgs.tesseract # pytesseract backend (eng only for now)
  ];
}
