export async function readBookmarkImport(file: Pick<File, "name" | "size" | "text">) {
  if (!/\.html?$/i.test(file.name)) throw new Error("Choose a browser bookmark HTML file (.html or .htm).")
  if (file.size > 1000000) throw new Error("Import an HTML file smaller than 1 MB. Split larger exports into smaller files.")
  return file.text()
}
